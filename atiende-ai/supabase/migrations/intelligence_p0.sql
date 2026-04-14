-- ════════════════════════════════════════════════════════════════════════════
-- INTELIGENCIA P0 — Phase 2.C
--
-- Extiende el schema con:
--   1. Columnas calculadas en contacts, appointments, tenants (health scores,
--      risk scores, churn probability, LTV, confirmation codes, etc.).
--   2. Función `calculate_no_show_risk(appointment_id)` — heurística pura SQL.
--   3. Trigger que recalcula el risk al cambiar no_show_reminded/confirmed_at.
--   4. Views de dashboard: `revenue_at_risk_today`, `patient_health_summary`.
--   5. Tabla `payments` stub (las views la referencian para LTV/ticket promedio).
--   6. Tabla `cron_runs` para registrar ejecuciones del cron no-show.
--
-- Idempotente: IF NOT EXISTS en columnas, tablas, índices. DROP/CREATE en
-- funciones, triggers y views (safe to re-run).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas extendidas ─────────────────────────────────────────────────

-- contacts: salud del paciente, score de churn, LTV, contador de no-shows
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS no_show_count            INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score             INTEGER     DEFAULT 50,
  ADD COLUMN IF NOT EXISTS churn_probability        INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_value_mxn       INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_visit_predicted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_risk_score       INTEGER     DEFAULT 0;

COMMENT ON COLUMN contacts.no_show_count IS
  'Contador acumulado de citas que el paciente no asistió. Input a calculate_no_show_risk().';
COMMENT ON COLUMN contacts.health_score IS
  'Score 0-100 de salud del paciente como cliente: asistencia + recencia + antigüedad + no-shows.';
COMMENT ON COLUMN contacts.churn_probability IS
  'Probabilidad 0-100 de que el paciente abandone el consultorio en los próximos 90 días.';
COMMENT ON COLUMN contacts.lifetime_value_mxn IS
  'Valor acumulado en pesos MXN que este paciente ha generado históricamente.';

-- appointments: risk score + columnas de estado para NO-SHOW worker + AGENDA tools
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS no_show_risk_score  INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count       INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_reminded    BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminded_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_code   TEXT;

-- Backfill confirmation_code en filas existentes que no lo tengan.
UPDATE appointments
  SET confirmation_code = upper(substring(gen_random_uuid()::text, 1, 8))
WHERE confirmation_code IS NULL;

COMMENT ON COLUMN appointments.no_show_risk_score IS
  'Riesgo 0-100 calculado por calculate_no_show_risk(id).';
COMMENT ON COLUMN appointments.confirmation_code IS
  '8-char uppercase hex — referencia humana compartida con el paciente al agendar.';

-- tenants: configuración + metadata adicional
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS health_score             INTEGER     DEFAULT 50,
  ADD COLUMN IF NOT EXISTS health_score_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_insurances      JSONB       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS maps_url                 TEXT,
  ADD COLUMN IF NOT EXISTS parking_info             TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone          TEXT,
  ADD COLUMN IF NOT EXISTS owner_phone              TEXT,
  ADD COLUMN IF NOT EXISTS doctor_name              TEXT;

COMMENT ON COLUMN tenants.accepted_insurances IS
  'Array JSON de aseguradoras aceptadas. Ej: ["AXA", "GNP", "MetLife"]';

-- ── 2. Tabla payments (stub — poblada en Phase 3 cuando COBRANZA llegue) ──

CREATE TABLE IF NOT EXISTS payments (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id        UUID          REFERENCES appointments(id) ON DELETE SET NULL,
  customer_phone        TEXT          NOT NULL,
  amount                NUMERIC(10,2) NOT NULL,
  currency              TEXT          DEFAULT 'MXN',
  status                TEXT          DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  provider              TEXT,
  provider_payment_id   TEXT,
  created_at            TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE payments IS
  'Registro de pagos del paciente al tenant. Alimenta LTV y revenue_at_risk views.';

CREATE INDEX IF NOT EXISTS idx_payments_tenant_phone
  ON payments(tenant_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_payments_appointment
  ON payments(appointment_id) WHERE appointment_id IS NOT NULL;

-- RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_tenant_isolation ON payments;
CREATE POLICY payments_tenant_isolation ON payments
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 3. Tabla cron_runs para registro de ejecuciones del cron no-show ─────

CREATE TABLE IF NOT EXISTS cron_runs (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     TEXT          NOT NULL,
  started_at   TIMESTAMPTZ   DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  tenants_processed INTEGER  DEFAULT 0,
  tenants_succeeded INTEGER  DEFAULT 0,
  tenants_failed    INTEGER  DEFAULT 0,
  total_cost_usd    NUMERIC(10,6) DEFAULT 0,
  duration_ms       INTEGER,
  details           JSONB    DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_date
  ON cron_runs(job_name, started_at DESC);

-- ── 4. Función: calculate_no_show_risk ─────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_no_show_risk(p_appointment_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score              INTEGER := 0;
  v_apt                RECORD;
  v_patient_no_shows   INTEGER;
  v_days_advance       INTEGER;
  v_hour_local         INTEGER;
BEGIN
  -- Join con contacts para traer no_show_count del paciente
  SELECT a.*, c.no_show_count AS contact_no_show_count
    INTO v_apt
  FROM appointments a
  LEFT JOIN contacts c
    ON c.phone = a.customer_phone
   AND c.tenant_id = a.tenant_id
  WHERE a.id = p_appointment_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- ── Historial de no-shows del paciente (0-40 puntos) ────────────────────
  v_patient_no_shows := COALESCE(v_apt.contact_no_show_count, 0);
  IF v_patient_no_shows >= 2 THEN
    v_score := v_score + 40;
  ELSIF v_patient_no_shows = 1 THEN
    v_score := v_score + 20;
  END IF;

  -- ── Días de anticipación (0-15 puntos) ─────────────────────────────────
  -- Muchos días → más chance de olvidar.
  v_days_advance := GREATEST(0, EXTRACT(DAY FROM v_apt.datetime - NOW())::INTEGER);
  IF v_days_advance > 7 THEN
    v_score := v_score + 15;
  ELSIF v_days_advance > 3 THEN
    v_score := v_score + 5;
  END IF;

  -- ── Día de la semana: lunes = mayor riesgo (0-10 puntos) ───────────────
  IF EXTRACT(DOW FROM v_apt.datetime) = 1 THEN
    v_score := v_score + 10;
  END IF;

  -- ── Hora extrema: muy temprano o muy tarde (0-10 puntos) ────────────────
  v_hour_local := EXTRACT(HOUR FROM v_apt.datetime AT TIME ZONE 'America/Merida')::INTEGER;
  IF v_hour_local < 9 OR v_hour_local > 17 THEN
    v_score := v_score + 10;
  END IF;

  -- ── No confirmó tras recibir recordatorio (0-20 puntos) ─────────────────
  IF v_apt.no_show_reminded = TRUE AND v_apt.confirmed_at IS NULL THEN
    v_score := v_score + 20;
  END IF;

  -- ── Status cancelado previamente: reset ─────────────────────────────────
  IF v_apt.status = 'cancelled' THEN
    RETURN 0;
  END IF;

  -- Cap at 100
  RETURN LEAST(v_score, 100);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_no_show_risk IS
  'Calcula score 0-100 de riesgo de no-show para una cita. Heurística pura SQL.';

-- ── 5. Trigger: recalcular risk al INSERT y en cambios relevantes ──────────

CREATE OR REPLACE FUNCTION update_appointment_risk()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalcular solo si cambian campos que impactan el score, o en INSERT.
  NEW.no_show_risk_score := calculate_no_show_risk(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointment_risk_insert ON appointments;
DROP TRIGGER IF EXISTS trg_appointment_risk_update ON appointments;

-- INSERT: asignar score inicial (no depende de otros campos en este momento)
CREATE TRIGGER trg_appointment_risk_insert
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_appointment_risk();

-- UPDATE: recalcular solo cuando cambien los inputs relevantes, evitar loops
CREATE TRIGGER trg_appointment_risk_update
  BEFORE UPDATE OF no_show_reminded, confirmed_at, status, datetime ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_appointment_risk();

-- ── 6. View: revenue_at_risk_today ─────────────────────────────────────────

DROP VIEW IF EXISTS revenue_at_risk_today CASCADE;
CREATE VIEW revenue_at_risk_today AS
SELECT
  a.tenant_id,
  COUNT(*)::INTEGER                                       AS appointments_at_risk,
  SUM(
    COALESCE(
      (SELECT AVG(amount)::NUMERIC
         FROM payments p
        WHERE p.customer_phone = a.customer_phone
          AND p.tenant_id = a.tenant_id),
      500.00 -- ticket default MXN si el paciente no tiene pagos previos
    ) * (a.no_show_risk_score::DECIMAL / 100.0)
  )::NUMERIC(10,2)                                        AS revenue_at_risk_mxn,
  MAX(a.no_show_risk_score)::INTEGER                      AS max_risk_score,
  NOW()                                                   AS calculated_at
FROM appointments a
WHERE DATE(a.datetime AT TIME ZONE 'America/Merida') = CURRENT_DATE
  AND a.status = 'scheduled'
  AND a.no_show_risk_score > 50
GROUP BY a.tenant_id;

COMMENT ON VIEW revenue_at_risk_today IS
  'Estimación de pesos MXN en riesgo hoy por no-shows probables. Uso dashboard.';

-- ── 7. View: patient_health_summary ────────────────────────────────────────

DROP VIEW IF EXISTS patient_health_summary CASCADE;
CREATE VIEW patient_health_summary AS
SELECT
  c.id                                                     AS contact_id,
  c.tenant_id,
  c.phone,
  c.name,
  -- Tasa de asistencia (0-100)
  ROUND(
    100.0 * COUNT(CASE WHEN a.status = 'completed' THEN 1 END) /
    NULLIF(COUNT(a.id), 0)
  )::INTEGER                                               AS attendance_rate,
  -- Citas completadas
  COUNT(CASE WHEN a.status = 'completed' THEN 1 END)::INTEGER
                                                           AS completed_visits,
  -- Días desde última visita completada
  EXTRACT(DAY FROM
    NOW() - MAX(CASE WHEN a.status = 'completed' THEN a.datetime END)
  )::INTEGER                                               AS days_since_last_visit,
  -- LTV histórico
  COALESCE(
    (SELECT SUM(amount)::INTEGER
       FROM payments p
      WHERE p.customer_phone = c.phone
        AND p.tenant_id = c.tenant_id
        AND p.status = 'completed'),
    0
  )                                                        AS historical_ltv_mxn,
  -- Health score compuesto (0-100)
  LEAST(100, GREATEST(0,
    -- Asistencia 35%
    COALESCE(ROUND(35.0 * COUNT(CASE WHEN a.status = 'completed' THEN 1 END) /
                   NULLIF(COUNT(a.id), 0))::INTEGER, 0)
    -- Recencia 25%
    + CASE
        WHEN MAX(a.datetime) > NOW() - INTERVAL '30 days'  THEN 25
        WHEN MAX(a.datetime) > NOW() - INTERVAL '60 days'  THEN 15
        WHEN MAX(a.datetime) > NOW() - INTERVAL '90 days'  THEN 5
        ELSE 0
      END
    -- Antigüedad 20%
    + LEAST(20,
        COALESCE(EXTRACT(MONTH FROM NOW() - MIN(a.datetime))::INTEGER, 0) * 2
      )
    -- Sin no-shows 20%
    + GREATEST(0, 20 - (COALESCE(c.no_show_count, 0) * 5))
  ))::INTEGER                                              AS health_score
FROM contacts c
LEFT JOIN appointments a
  ON a.customer_phone = c.phone
 AND a.tenant_id     = c.tenant_id
GROUP BY c.id, c.tenant_id, c.phone, c.name, c.no_show_count;

COMMENT ON VIEW patient_health_summary IS
  'Métricas agregadas por paciente: asistencia, recencia, LTV, health_score. Uso dashboard.';

-- ── 8. Índices para performance del dashboard ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_risk_scheduled
  ON appointments(tenant_id, no_show_risk_score DESC)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_appointments_noshow_pending
  ON appointments(tenant_id, status, no_show_reminded, datetime)
  WHERE status = 'scheduled' AND no_show_reminded = FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_health
  ON contacts(tenant_id, health_score DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_churn
  ON contacts(tenant_id, churn_probability DESC)
  WHERE churn_probability > 30;

-- ── 9. Backfill inicial de no_show_risk_score para citas futuras ──────────
-- Esto dispara el trigger (BEFORE UPDATE of status) al tocar el status,
-- pero usamos un UPDATE que no cambia nada efectivamente.

UPDATE appointments
   SET no_show_risk_score = calculate_no_show_risk(id)
 WHERE datetime > NOW()
   AND status IN ('scheduled', 'confirmed');
