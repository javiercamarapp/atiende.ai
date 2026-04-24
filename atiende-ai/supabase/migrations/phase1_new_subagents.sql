-- Phase 1 — Support tables for 5 new subagents
--
-- Los 5 nuevos agentes (quoting, pharmacovigilance, administrative,
-- doctor-profile, payment-resolution) en su mayoría pueden persistir su
-- estado en `contact_events` (tabla agregada en profile_enrichment.sql)
-- usando distintos `event_type`.
--
-- La ÚNICA excepción que justifica tabla propia es `adverse_events`:
-- COFEPRIS y cualquier auditoría médica legal requieren trazabilidad
-- estructurada — columna tipada para severity, onset_hours, status, etc.
--
-- IDEMPOTENTE.

-- adverse_events: reacción adversa a medicamento reportada por paciente
CREATE TABLE IF NOT EXISTS adverse_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
  medication      TEXT NOT NULL,
  symptoms        TEXT NOT NULL,
  onset_hours     INT,                    -- horas desde primera dosis hasta síntoma
  severity        TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe', 'life_threatening')),
  doctor_notified BOOLEAN DEFAULT FALSE,
  doctor_notified_at TIMESTAMPTZ,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'escalated_to_hospital')),
  resolution      TEXT,
  patient_phone   TEXT NOT NULL,
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adverse_tenant_status
  ON adverse_events (tenant_id, status, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_adverse_contact
  ON adverse_events (contact_id, reported_at DESC);

ALTER TABLE adverse_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'adverse_events'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON adverse_events FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
