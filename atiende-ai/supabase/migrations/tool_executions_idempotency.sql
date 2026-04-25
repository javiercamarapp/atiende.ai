-- ═══════════════════════════════════════════════════════════════════════════
-- TOOL EXECUTIONS IDEMPOTENCY — DB-level guard against ghost mutations
--
-- Capa adicional sobre los 2 niveles existentes:
--   1) In-memory cache compartida (orchestrator dentro del mismo turn)
--   2) Redis NX 60s (cross-instance dentro del mismo cold-start)
--   3) ESTA TABLA — defensa final cross-process / cross-region
--
-- Una mutación se inserta acá ANTES de tocar la tabla destino. La UNIQUE
-- constraint garantiza que ningún (tenantId, conversationId, toolName,
-- argsHash) pueda ejecutarse dos veces, incluso si Redis falla por
-- timeout o si el lambda se recicla mid-execution.
--
-- Idempotente: idéntico a las migraciones previas — `CREATE TABLE IF NOT
-- EXISTS` + checks de columnas para que múltiples deploys del mismo SQL
-- no exploten.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tool_executions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  -- argsHash = SHA-256(JSON.stringify(sortKeysDeep(args))) hex truncado a 32.
  -- Identifica unívocamente el (tool, args) sin almacenar PII.
  args_hash TEXT NOT NULL,
  -- Resultado serializado (puede ser null si la tool aún está en progreso).
  result JSONB,
  success BOOLEAN,
  duration_ms INTEGER,
  -- error_code legible por el LLM si la tool falló (SLOT_TAKEN, etc.).
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Garantía de idempotencia: misma tupla NUNCA puede insertarse 2 veces.
  -- Si el INSERT explota con 23505, el caller sabe que ya se ejecutó.
  CONSTRAINT tool_executions_unique
    UNIQUE (tenant_id, conversation_id, tool_name, args_hash)
);

-- Index para queries rápidas de "qué hizo este tool en esta conversación".
CREATE INDEX IF NOT EXISTS idx_tool_executions_tenant_conv
  ON tool_executions (tenant_id, conversation_id, created_at DESC);

-- TTL de retención: 60 días basta para auditoría + debugging. Más allá de
-- eso son datos viejos sin valor operativo. Cron limpia mensualmente.
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at
  ON tool_executions (created_at);

-- RLS: solo accesible vía service_role (los crons + el orchestrator).
-- Los users finales no necesitan leer esta tabla.
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_executions_service_role_only ON tool_executions;
CREATE POLICY tool_executions_service_role_only ON tool_executions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE tool_executions IS
  'Registro de ejecuciones de tools del orchestrator. Garantiza idempotencia '
  'a nivel DB (UNIQUE constraint). Capa 3 sobre in-memory cache + Redis NX.';
