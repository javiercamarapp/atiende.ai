-- ════════════════════════════════════════════════════════════════════════════
-- FIXUPS Phase 3.D — post-hoc adjustments
--
-- (1) tool_call_logs.conversation_id debe ser NULLABLE porque los crons
--     worker (no-show, retention, cobranza, etc.) ejecutan agentes FUERA
--     de una conversación WhatsApp — pasan conversation_id='' lo cual
--     viola el NOT NULL original de tool_calling_setup.sql.
--
-- (2) Campo tool_call_logs.success: los inserts del cron worker omiten este
--     campo. Le damos default TRUE para no bloquear inserts.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) Permitir conversation_id NULL en tool_call_logs
ALTER TABLE tool_call_logs
  ALTER COLUMN conversation_id DROP NOT NULL;

COMMENT ON COLUMN tool_call_logs.conversation_id IS
  'NULL cuando la tool call fue ejecutada por un cron worker (no-show, retention, cobranza, etc.) fuera de una conversación WhatsApp.';

-- (2) Default TRUE en success para que cron workers no tengan que pasarlo
ALTER TABLE tool_call_logs
  ALTER COLUMN success SET DEFAULT TRUE;
