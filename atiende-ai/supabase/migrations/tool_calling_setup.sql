-- ════════════════════════════════════════════════════════════════════════════
-- TOOL CALLING SETUP (Fase 1 de la migración a arquitectura agentica)
--
-- Agrega:
--   1. `tenants.features` JSONB para feature-flag por tenant. La key
--      `tool_calling: true` activa el nuevo pipeline para ese tenant
--      cuando la env var global USE_TOOL_CALLING también está activada.
--
--   2. `tool_call_logs` para auditar cada tool ejecutada por el orquestador
--      en producción: qué tool, con qué args, cuánto tardó, si tuvo error,
--      qué modelo se usó, si cayó al fallback.
--
-- Idempotente: usa IF NOT EXISTS en todo. Seguro de re-correr.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Feature flag por tenant ─────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.features IS
  'Feature flags por tenant. Ejemplo: { "tool_calling": true } activa el nuevo orquestador agentico cuando USE_TOOL_CALLING=true a nivel global.';

-- ── 2. Tabla de auditoría de tool calls ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_call_logs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_name      TEXT         NOT NULL,
  tool_name       TEXT         NOT NULL,
  args            JSONB,
  result          JSONB,
  success         BOOLEAN      NOT NULL,
  error_message   TEXT,
  duration_ms     INTEGER,
  model_used      TEXT,
  fallback_used   BOOLEAN      DEFAULT FALSE,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE tool_call_logs IS
  'Auditoría de cada tool ejecutada por el orquestador en producción. Permite debugging, métricas de costo y detección de tools que fallan o son lentas.';

-- Índice 1: queries por tenant más reciente primero (dashboards de admin)
CREATE INDEX IF NOT EXISTS idx_tool_call_logs_tenant
  ON tool_call_logs (tenant_id, created_at DESC);

-- Índice 2: queries por conversación (debugging de un thread específico)
CREATE INDEX IF NOT EXISTS idx_tool_call_logs_conversation
  ON tool_call_logs (conversation_id);

-- ── 3. RLS — solo el dueño del tenant puede ver sus propios logs ──────────
-- Sigue el patrón usado en el resto del schema: helper get_user_tenant_id()
-- devuelve el tenant_id del usuario autenticado.
ALTER TABLE tool_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_call_logs_tenant_isolation ON tool_call_logs;
CREATE POLICY tool_call_logs_tenant_isolation ON tool_call_logs
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- El service_role bypasa RLS automáticamente, así que el processor.ts puede
-- insertar sin problemas usando supabaseAdmin (que usa service_role key).
