-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: tracing_request_id
-- Agrega request_id (UUID generado en el webhook entry) a las tablas
-- principales para correlacionar TODA la actividad de una conversación
-- a través del stack: webhook → processor → orchestrator → tool-executor.
--
-- Cada inbound message recibe un request_id; outbound, tool calls y
-- audit log heredan el mismo. Permite:
--   - Debug post-mortem: pegar 1 request_id en SQL → ver toda la traza
--   - Métricas: latencia por request, tools por request, costo por request
--   - Alertas: correlacionar errores específicos con la cadena completa
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE INDEX IF NOT EXISTS idx_messages_request_id
  ON messages(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE tool_call_logs
  ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE INDEX IF NOT EXISTS idx_tool_call_logs_request_id
  ON tool_call_logs(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
  ON audit_log(request_id) WHERE request_id IS NOT NULL;

COMMENT ON COLUMN messages.request_id IS
  'UUID del webhook request que originó este mensaje. Mismo request_id en messages, tool_call_logs y audit_log permite correlacionar la cadena completa para debugging post-mortem.';
