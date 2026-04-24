-- Phase 3 — Treatment plans (tratamientos multi-sesión)
--
-- Ortodoncia (20+ sesiones), fisioterapia (10-30), endodoncia con coronas
-- (3-5), implantes con osteointegración (3 meses). Sin estructura, 30% de
-- pacientes drop out entre sesiones. El MOAT: el sistema sabe que sesión 5
-- de 12 completó → auto-sugiere sesión 6, confirma adherencia, alerta al
-- dueño si pasa 1 semana sin reschedule.
--
-- Modelo:
--   - treatment_plans: el plan de tratamiento (total_sessions, cadence,
--     target_end_date)
--   - treatment_sessions: cada sesión individual, linkea a appointments
--     cuando la sesión se agenda/completa. Existe ANTES de que la cita
--     se agende (es el "slot" planeado).
--
-- Relación con appointments: una cita pertenece a 0 o 1 sesión; una sesión
-- tiene 0 o 1 appointment (mientras no se agende).
--
-- IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS treatment_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  staff_id           UUID REFERENCES staff(id) ON DELETE SET NULL,

  plan_type          TEXT NOT NULL,     -- 'orthodontics', 'physiotherapy', 'endodontics', 'implant', 'other'
  plan_name          TEXT NOT NULL,     -- 'Ortodoncia con brackets metálicos', 'Rehabilitación post-cirugía rodilla'
  total_sessions     INT NOT NULL CHECK (total_sessions BETWEEN 2 AND 200),
  cadence_days       INT,                -- frecuencia sugerida (ej. 21 para orto mensual, 2 para fisio cada 2 días)
  estimated_duration_weeks INT,          -- duración total estimada
  target_end_date    DATE,

  -- Costo total si el paciente pagó paquete; null si pay-per-session
  total_cost_mxn     DECIMAL(10, 2),
  payment_model      TEXT DEFAULT 'per_session'
    CHECK (payment_model IN ('per_session', 'package_upfront', 'package_installments')),

  status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'paused', 'abandoned', 'cancelled')),

  notes              TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  abandoned_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_contact
  ON treatment_plans (contact_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_tenant_active
  ON treatment_plans (tenant_id, status) WHERE status = 'active';

ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plans'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON treatment_plans FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- Cada sesión individual dentro del plan
CREATE TABLE IF NOT EXISTS treatment_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            UUID NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_number     INT NOT NULL,      -- 1, 2, ..., total_sessions
  milestone_label    TEXT,              -- 'Ajuste mensual', 'Colocación coronas', 'Alta'
  expected_date      DATE,              -- fecha sugerida por el plan
  appointment_id     UUID REFERENCES appointments(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'completed', 'skipped', 'cancelled')),
  completion_notes   TEXT,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (plan_id, session_number)
);

CREATE INDEX IF NOT EXISTS idx_sessions_plan
  ON treatment_sessions (plan_id, session_number);
CREATE INDEX IF NOT EXISTS idx_sessions_pending
  ON treatment_sessions (tenant_id, expected_date)
  WHERE status = 'pending';

ALTER TABLE treatment_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_sessions'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON treatment_sessions FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
