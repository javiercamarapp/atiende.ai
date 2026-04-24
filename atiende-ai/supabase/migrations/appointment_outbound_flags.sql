-- Flags para que los crons post-consulta (encuesta + medicamento) no procesen
-- la misma cita dos veces. Nullable / default false para legacy rows.
--
-- Uso:
--   /api/cron/satisfaction-survey  — filtra survey_sent=false, marca true tras enviar
--   /api/cron/medication-processing — filtra prescription_processed=false, marca true tras encolar
--
-- completed_at y doctor_notes ya existían (phase3_schema.sql / CONSOLIDATED_APPLY.sql).

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS survey_sent              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS survey_sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prescription_processed   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prescription_processed_at TIMESTAMPTZ;

-- Índices parciales: solo filas pendientes de cada proceso. Mantiene los
-- índices chicos porque la vasta mayoría de citas viejas ya están procesadas.
CREATE INDEX IF NOT EXISTS idx_apt_pending_survey
  ON appointments (tenant_id, completed_at)
  WHERE status = 'completed' AND survey_sent = FALSE;

CREATE INDEX IF NOT EXISTS idx_apt_pending_prescription
  ON appointments (tenant_id, completed_at)
  WHERE status = 'completed' AND prescription_processed = FALSE AND doctor_notes IS NOT NULL;
