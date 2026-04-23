-- ════════════════════════════════════════════════════════════════════════════
-- APPOINTMENTS OWNER NOTIFY — retry-able notification tracking
--
-- Antes: notifyOwner() fallaba en silencio con try/catch vacío. Si Resend /
-- Twilio / WhatsApp del dueño tenían downtime momentáneo, el consultorio
-- perdía visibilidad de citas recién agendadas.
--
-- Ahora: cada book_appointment intenta notificar y persiste el resultado.
-- Un cron (a crear) escanea owner_notified=false y reintenta.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS owner_notified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_notify_error TEXT,
  ADD COLUMN IF NOT EXISTS owner_notify_retry_count INT DEFAULT 0;

-- Índice parcial para el cron de reintento — solo escanea pendientes.
CREATE INDEX IF NOT EXISTS idx_appointments_owner_notify_pending
  ON appointments(tenant_id, created_at DESC)
  WHERE owner_notified = false AND status IN ('scheduled', 'confirmed');

COMMENT ON COLUMN appointments.owner_notified IS
  'TRUE si notifyOwner() completó OK al crear la cita. FALSE pendiente de reintento.';
COMMENT ON COLUMN appointments.owner_notified_at IS
  'Timestamp del notify exitoso (NULL si aún no).';
COMMENT ON COLUMN appointments.owner_notify_error IS
  'Último error capturado al intentar notificar al dueño.';
COMMENT ON COLUMN appointments.owner_notify_retry_count IS
  'Contador de reintentos — el cron incrementa, máx 3 antes de dar up.';
