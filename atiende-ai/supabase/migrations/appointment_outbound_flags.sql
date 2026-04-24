-- Migration autosuficiente: agrega TODAS las columnas que los crons
-- satisfaction-survey + medication-processing necesitan, sin asumir que
-- phase3_schema.sql u otras migrations previas corrieron en este tenant.
--
-- Columnas previas (completed_at, doctor_notes, intake_completed_at)
-- aparecen en CONSOLIDATED_APPLY.sql y phase3_schema.sql pero usuarios
-- que aplicaron migrations parcialmente no las tienen → los CREATE INDEX
-- de abajo fallaban con "column does not exist".
--
-- IDEMPOTENTE. Correr múltiples veces es seguro (IF NOT EXISTS en todo).

-- 1. Columnas base del lifecycle "completado" (si no estaban).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doctor_notes   TEXT;

-- 2. Flags outbound de esta PR.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS survey_sent                BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS survey_sent_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prescription_processed     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prescription_processed_at  TIMESTAMPTZ;

-- 3. Índices parciales: solo filas pendientes de procesamiento. El cron
--    hace SELECT WHERE status='completed' AND survey_sent=FALSE ORDER BY
--    completed_at, así que el partial index cubre esa query sin inflarse
--    con el histórico completo.
CREATE INDEX IF NOT EXISTS idx_apt_pending_survey
  ON appointments (tenant_id, completed_at)
  WHERE status = 'completed' AND survey_sent = FALSE;

CREATE INDEX IF NOT EXISTS idx_apt_pending_prescription
  ON appointments (tenant_id, completed_at)
  WHERE status = 'completed' AND prescription_processed = FALSE AND doctor_notes IS NOT NULL;
