-- ════════════════════════════════════════════════════════════════════════════
-- INTELLIGENCE FUNCTIONS — P0 + P1
--
-- Funciones SQL para health_score, churn_probability, next_visit_prediction,
-- lifetime_value y optimal_reminder_hour por paciente. Ejecutadas en batch
-- por el cron /api/cron/intelligence (3am Mérida).
--
-- Idempotente (CREATE OR REPLACE). Safe re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Columnas requeridas que pueden faltar ────────────────────────────────

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary TEXT;

COMMENT ON COLUMN conversations.summary IS
  'Resumen LLM 2-3 líneas de la conversación. Actualizado por cron intelligence cuando hay 2h sin actividad.';

-- ── 1. calculate_patient_health_score ──────────────────────────────────────
-- Fórmula ponderada:
--   attendance_rate * 35   (asistencia)
--   recency_score  * 25    (recencia: 25 si <30d, 15 <60d, 5 <90d, 0 si más)
--   tenure_score   * 20    (meses desde primera cita * 2, max 20)
--   no_show_penalty * 20   (20 - no_show_count*5, min 0)
-- Total capped en 0-100.

CREATE OR REPLACE FUNCTION calculate_patient_health_score(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_contact       RECORD;
  v_total         INTEGER;
  v_completed     INTEGER;
  v_last_visit    TIMESTAMPTZ;
  v_first_visit   TIMESTAMPTZ;
  v_attendance    NUMERIC;
  v_recency_score INTEGER := 0;
  v_tenure_score  INTEGER := 0;
  v_no_show_pen   INTEGER := 20;
  v_score         INTEGER := 0;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN 50; END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    MAX(CASE WHEN status = 'completed' THEN datetime END),
    MIN(CASE WHEN status = 'completed' THEN datetime END)
  INTO v_total, v_completed, v_last_visit, v_first_visit
  FROM appointments
  WHERE tenant_id = v_contact.tenant_id
    AND customer_phone = v_contact.phone;

  -- Attendance (0-35)
  v_attendance := CASE WHEN v_total > 0 THEN v_completed::NUMERIC / v_total ELSE 0 END;
  v_score := v_score + ROUND(35 * v_attendance)::INTEGER;

  -- Recency (0-25)
  IF v_last_visit IS NOT NULL THEN
    IF v_last_visit > NOW() - INTERVAL '30 days' THEN v_recency_score := 25;
    ELSIF v_last_visit > NOW() - INTERVAL '60 days' THEN v_recency_score := 15;
    ELSIF v_last_visit > NOW() - INTERVAL '90 days' THEN v_recency_score := 5;
    ELSE v_recency_score := 0;
    END IF;
  END IF;
  v_score := v_score + v_recency_score;

  -- Tenure (meses desde primera cita * 2, cap 20)
  IF v_first_visit IS NOT NULL THEN
    v_tenure_score := LEAST(
      20,
      GREATEST(0, EXTRACT(MONTH FROM AGE(NOW(), v_first_visit))::INTEGER * 2)
    );
  END IF;
  v_score := v_score + v_tenure_score;

  -- No-show penalty (20 - count*5, floor 0)
  v_no_show_pen := GREATEST(0, 20 - COALESCE(v_contact.no_show_count, 0) * 5);
  v_score := v_score + v_no_show_pen;

  RETURN LEAST(100, GREATEST(0, v_score));
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_patient_health_score IS
  'Health score 0-100 ponderado: 35% asistencia + 25% recencia + 20% tenure + 20% sin no-shows.';

-- Trigger que recalcula health_score al modificar columnas relevantes del contact
CREATE OR REPLACE FUNCTION trg_contacts_recalc_health()
RETURNS TRIGGER AS $$
BEGIN
  -- Evitar recursión infinita: solo recalcular si NO estamos tocando health_score ya
  IF NEW.health_score IS NOT DISTINCT FROM OLD.health_score
     OR TG_OP = 'INSERT' THEN
    NEW.health_score := calculate_patient_health_score(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_recalc_health ON contacts;
CREATE TRIGGER trg_contacts_recalc_health
  BEFORE UPDATE OF no_show_count, lifetime_value_mxn ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trg_contacts_recalc_health();

-- ── 2. calculate_churn_probability ──────────────────────────────────────────
-- Reglas:
--   última cita >90d + sin respuesta último mensaje   → 90
--   última cita >60d + canceló sin reagendar          → 60
--   última cita >30d                                  → 30
--   visita en últimos 30d                             → 10
--   nunca tuvo cita                                   → 50

CREATE OR REPLACE FUNCTION calculate_churn_probability(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_contact          RECORD;
  v_last_completed   TIMESTAMPTZ;
  v_last_cancelled   TIMESTAMPTZ;
  v_has_future       BOOLEAN;
  v_last_msg_dir     TEXT;
  v_last_msg_at      TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN 50; END IF;

  SELECT MAX(datetime) INTO v_last_completed
    FROM appointments
   WHERE tenant_id = v_contact.tenant_id
     AND customer_phone = v_contact.phone
     AND status = 'completed';

  SELECT MAX(datetime) INTO v_last_cancelled
    FROM appointments
   WHERE tenant_id = v_contact.tenant_id
     AND customer_phone = v_contact.phone
     AND status = 'cancelled';

  SELECT EXISTS (
    SELECT 1 FROM appointments
     WHERE tenant_id = v_contact.tenant_id
       AND customer_phone = v_contact.phone
       AND status IN ('scheduled', 'confirmed')
       AND datetime > NOW()
  ) INTO v_has_future;

  SELECT direction, created_at INTO v_last_msg_dir, v_last_msg_at
    FROM messages
   WHERE tenant_id = v_contact.tenant_id
   ORDER BY created_at DESC
   LIMIT 1;

  -- Nunca tuvo cita
  IF v_last_completed IS NULL AND v_last_cancelled IS NULL THEN
    RETURN 50;
  END IF;

  -- Visita en últimos 30 días
  IF v_last_completed > NOW() - INTERVAL '30 days' THEN
    RETURN 10;
  END IF;

  -- >90 días + outbound sin respuesta
  IF v_last_completed < NOW() - INTERVAL '90 days' OR v_last_completed IS NULL THEN
    IF v_last_msg_dir = 'outbound' AND v_last_msg_at > NOW() - INTERVAL '14 days' THEN
      RETURN 90;
    END IF;
  END IF;

  -- >60 días + canceló sin reagendar
  IF v_last_cancelled > NOW() - INTERVAL '60 days' AND NOT v_has_future THEN
    IF v_last_completed IS NULL OR v_last_completed < v_last_cancelled THEN
      RETURN 60;
    END IF;
  END IF;

  -- >30 días
  IF v_last_completed < NOW() - INTERVAL '30 days' OR v_last_completed IS NULL THEN
    RETURN 30;
  END IF;

  RETURN 10;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_churn_probability IS
  'Probabilidad churn 0-100 por reglas de recencia + cancelaciones + respuesta.';

-- ── 3. calculate_next_visit_prediction ──────────────────────────────────────
-- Intervalo promedio entre citas completadas + última_cita.
-- Si <2 citas: NULL.

CREATE OR REPLACE FUNCTION calculate_next_visit_prediction(p_contact_id UUID)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_contact    RECORD;
  v_last_visit TIMESTAMPTZ;
  v_avg_days   NUMERIC;
  v_count      INTEGER;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Avg diff entre visitas consecutivas con LAG window
  WITH visits AS (
    SELECT datetime,
           LAG(datetime) OVER (ORDER BY datetime) AS prev_dt
      FROM appointments
     WHERE tenant_id = v_contact.tenant_id
       AND customer_phone = v_contact.phone
       AND status = 'completed'
     ORDER BY datetime
  )
  SELECT
    COUNT(*),
    AVG(EXTRACT(EPOCH FROM (datetime - prev_dt)) / 86400.0)
  INTO v_count, v_avg_days
  FROM visits
  WHERE prev_dt IS NOT NULL;

  IF v_count < 1 THEN RETURN NULL; END IF;

  SELECT MAX(datetime) INTO v_last_visit
    FROM appointments
   WHERE tenant_id = v_contact.tenant_id
     AND customer_phone = v_contact.phone
     AND status = 'completed';

  IF v_last_visit IS NULL OR v_avg_days IS NULL THEN RETURN NULL; END IF;

  RETURN v_last_visit + (v_avg_days * INTERVAL '1 day');
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_next_visit_prediction IS
  'Predice próxima visita del paciente basada en intervalo promedio histórico.';

-- ── 4. calculate_lifetime_value ─────────────────────────────────────────────
-- SUM(payments.amount) si existe; sino COUNT(completed_appointments)*500.

CREATE OR REPLACE FUNCTION calculate_lifetime_value(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_contact   RECORD;
  v_payments  NUMERIC;
  v_completed INTEGER;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_payments
    FROM payments
   WHERE tenant_id = v_contact.tenant_id
     AND customer_phone = v_contact.phone
     AND status = 'completed';

  IF v_payments > 0 THEN
    RETURN ROUND(v_payments)::INTEGER;
  END IF;

  SELECT COUNT(*) INTO v_completed
    FROM appointments
   WHERE tenant_id = v_contact.tenant_id
     AND customer_phone = v_contact.phone
     AND status = 'completed';

  RETURN v_completed * 500;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_lifetime_value IS
  'LTV en MXN: SUM(payments) completed o estimación count(completed_appointments)*500.';

-- ── 5. calculate_optimal_reminder_hour ──────────────────────────────────────
-- Hora más frecuente de respuesta del paciente (inbound messages).
-- Default 10 si no hay historial.

CREATE OR REPLACE FUNCTION calculate_optimal_reminder_hour(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_contact  RECORD;
  v_hour     INTEGER;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN 10; END IF;

  SELECT EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'America/Merida')::INTEGER AS h
  INTO v_hour
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.tenant_id = v_contact.tenant_id
    AND c.customer_phone = v_contact.phone
    AND m.direction = 'inbound'
  GROUP BY h
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  RETURN COALESCE(v_hour, 10);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_optimal_reminder_hour IS
  'Hora (0-23) con mayor probabilidad de respuesta del paciente. Default 10.';
