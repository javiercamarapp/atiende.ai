-- ════════════════════════════════════════════════════════════════════════════
-- TEXT-TO-SQL — Phase 6.1
--
-- Función execute_safe_readonly_query que ejecuta SELECT arbitrarios generados
-- por LLM con validaciones de seguridad:
--   1. Solo SELECT (regex contra keywords destructivos)
--   2. SIEMPRE incluir tenant_id como filtro
--   3. Timeout de 5 segundos (statement_timeout)
--
-- Retorna JSONB. Si falla validación: raise exception.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION execute_safe_readonly_query(
  query_sql TEXT,
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       JSONB;
  lowered      TEXT;
  forbidden    TEXT[] := ARRAY[
    'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create',
    'grant', 'revoke', 'replace', 'copy', 'do ', 'execute', 'listen',
    'notify', 'lock', 'vacuum', 'analyze', 'reset', 'comment on'
  ];
  kw           TEXT;
  sanitized    TEXT;
BEGIN
  -- Normalizar whitespace + lowercase para checks
  sanitized := regexp_replace(trim(query_sql), '\s+', ' ', 'g');
  lowered   := lower(sanitized);

  IF lowered = '' THEN
    RAISE EXCEPTION 'empty_query' USING ERRCODE = '22000';
  END IF;

  -- Debe empezar con SELECT o WITH
  IF NOT (lowered LIKE 'select %' OR lowered LIKE 'with %' OR lowered = 'select' OR lowered LIKE 'select(%') THEN
    RAISE EXCEPTION 'only_select_allowed: query must start with SELECT or WITH' USING ERRCODE = '22000';
  END IF;

  -- No múltiples statements: permitir máximo un ';' al final
  IF (length(lowered) - length(replace(lowered, ';', ''))) > 1 THEN
    RAISE EXCEPTION 'multiple_statements_forbidden' USING ERRCODE = '22000';
  END IF;

  -- Keywords prohibidos (whole-word-ish via boundary con espacios/símbolos)
  FOREACH kw IN ARRAY forbidden LOOP
    IF lowered ~ ('(^|[^a-z_])' || kw || '([^a-z_]|$)') THEN
      RAISE EXCEPTION 'forbidden_keyword: %', kw USING ERRCODE = '22000';
    END IF;
  END LOOP;

  -- Debe incluir tenant_id del usuario (defense in depth)
  IF position(p_tenant_id::text in query_sql) = 0 THEN
    RAISE EXCEPTION 'tenant_id_filter_required' USING ERRCODE = '22000';
  END IF;

  -- Timeout local de 5s
  SET LOCAL statement_timeout = '5s';

  -- Ejecutar envuelto en jsonb_agg para devolver array
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
          || rtrim(query_sql, '; ')
          || ') t'
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION execute_safe_readonly_query IS
  'Ejecuta SELECT generados por LLM. Valida: solo SELECT, sin keywords destructivos, debe incluir tenant_id del usuario. Retorna JSONB.';

-- RLS: solo usuarios autenticados (service_role ya bypasa)
REVOKE ALL ON FUNCTION execute_safe_readonly_query FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_safe_readonly_query TO authenticated;
