-- ════════════════════════════════════════════════════════════════════════════
-- DASHBOARD UNSATISFIED — Phase 4.A
--
-- Agrega columna conversations.unsatisfied BOOLEAN para que intelligence-alerts
-- pueda filtrar conversaciones flaggeadas por detectUnsatisfiedPatient().
-- El cron /api/cron/intelligence actualiza esta columna.
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS unsatisfied BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN conversations.unsatisfied IS
  'TRUE cuando detectUnsatisfiedPatient() detectó señales de frustración. Se resetea a FALSE cuando el assigned_to cambia (humano interviene).';

CREATE INDEX IF NOT EXISTS idx_conversations_unsatisfied
  ON conversations(tenant_id, unsatisfied, last_message_at DESC)
  WHERE unsatisfied = TRUE;
