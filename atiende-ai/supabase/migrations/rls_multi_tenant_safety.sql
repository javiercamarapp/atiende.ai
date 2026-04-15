-- ════════════════════════════════════════════════════════════════════════════
-- RLS MULTI-TENANT SAFETY (AUDIT-R10 ALTO)
--
-- Problema detectado:
--   `get_user_tenant_id()` usa `SELECT id FROM tenants WHERE user_id = auth.uid() LIMIT 1`.
--   Si un usuario acaba con 2 filas en tenants (bug de signup, futura feature de
--   multi-sucursal, o INSERT accidental), LIMIT 1 devuelve un ID aleatorio
--   dependiendo del plan del query → RLS rompe y el usuario ve datos cruzados.
--
-- Fix dual:
--   1. Agregar UNIQUE(user_id) — garantiza 1 tenant por user hoy.
--   2. Cambiar policies a `tenant_id IN (SELECT id FROM tenants ...)` — futuro-proof
--      si algún día permitimos multi-sucursal sin romper la seguridad.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PASO 1: UNIQUE(user_id) en tenants ──────────────────────────────────────
-- Detectar duplicados ANTES de crear el constraint (rompería con duplicados).
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT user_id FROM tenants WHERE user_id IS NOT NULL
    GROUP BY user_id HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % users with multiple tenants — manual cleanup required BEFORE UNIQUE constraint', dup_count;
  ELSE
    -- Seguro aplicar
    BEGIN
      ALTER TABLE tenants ADD CONSTRAINT tenants_user_id_unique UNIQUE (user_id);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- ya existe
    END;
  END IF;
END $$;

-- ─── PASO 2: RLS helper más robusto ──────────────────────────────────────────
-- Nueva función que retorna ARRAY (futuro-proof multi-sucursal).
-- La vieja get_user_tenant_id() sigue existiendo para compatibilidad.
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::UUID[])
  FROM tenants
  WHERE user_id = auth.uid();
$$;

COMMENT ON FUNCTION get_user_tenant_ids IS
  'Returns all tenant IDs for the current authenticated user. Replaces LIMIT 1 approach for multi-tenant future-proofing.';

-- ─── PASO 3: opcional — migrar policies a IN (...) ───────────────────────────
-- Comentado por default. Para activar: correr manualmente después de QA.
-- Ejemplo para tabla contacts:
--
-- DROP POLICY IF EXISTS contacts_tenant_isolation ON contacts;
-- CREATE POLICY contacts_tenant_isolation ON contacts FOR ALL
--   USING (tenant_id = ANY(get_user_tenant_ids()))
--   WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));
--
-- (Repetir para appointments, conversations, messages, voice_calls, etc.)
