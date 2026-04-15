-- ════════════════════════════════════════════════════════════════════════════
-- OPT-OUT — Phase 12 (LFPDPPP compliance + UX anti-spam)
--
-- Permite a pacientes solicitar baja de notificaciones automatizadas.
-- Cumple LFPDPPP 2025 (derecho de cancelación) y WhatsApp Business Policy
-- (no spam).
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out    BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.opted_out IS
  'TRUE cuando el paciente respondió STOP/BAJA/no me manden. Filtrar en TODOS los crons que envían mensajes outbound.';

-- Índice optimizado para query de cron: WHERE tenant_id = X AND opted_out = false
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts(tenant_id, opted_out)
  WHERE opted_out = FALSE;
