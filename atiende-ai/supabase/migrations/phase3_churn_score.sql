-- Phase 3 — Churn risk score (heuristic, multi-signal)
--
-- La columna contacts.churn_probability existía pero nada la escribía. Esta
-- migration agrega una función compute_churn_score(contact_id) que devuelve
-- 0-100 basado en señales reales:
--   1. Recencia de última cita completada (0..40 pts)
--   2. No-shows en últimos 6 meses (0..30 pts)
--   3. Treatment plan abandonado (0..25 pts)
--   4. Días sin último mensaje del paciente (0..25 pts)
--   5. Survey rating bajo si existe (0..20 pts)
-- Total cap a 100.
--
-- El cron `churn-recompute` corre nightly y actualiza la columna para todos
-- los contactos del tenant. El agente `retencion` lee la columna como antes.
--
-- IDEMPOTENTE.

CREATE OR REPLACE FUNCTION compute_churn_score(p_contact_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tenant_id          UUID;
  v_score              INT := 0;
  v_last_completed_at  TIMESTAMPTZ;
  v_days_since_visit   INT;
  v_recent_no_shows    INT;
  v_abandoned_plans    INT;
  v_last_msg_at        TIMESTAMPTZ;
  v_days_since_msg     INT;
  v_low_survey_count   INT;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM contacts WHERE id = p_contact_id;
  IF v_tenant_id IS NULL THEN RETURN 0; END IF;

  -- 1. Recencia de última cita completada (0..40)
  SELECT MAX(datetime) INTO v_last_completed_at
    FROM appointments
   WHERE contact_id = p_contact_id
     AND tenant_id  = v_tenant_id
     AND status     = 'completed';

  IF v_last_completed_at IS NULL THEN
    v_score := v_score + 20; -- nunca completó cita pero está en CRM = leve riesgo
  ELSE
    v_days_since_visit := EXTRACT(DAY FROM (now() - v_last_completed_at))::INT;
    v_score := v_score + LEAST(40,
      CASE
        WHEN v_days_since_visit < 30  THEN 0
        WHEN v_days_since_visit < 60  THEN 10
        WHEN v_days_since_visit < 90  THEN 20
        WHEN v_days_since_visit < 180 THEN 30
        ELSE 40
      END
    );
  END IF;

  -- 2. No-shows en últimos 6 meses (0..30)
  SELECT COUNT(*) INTO v_recent_no_shows
    FROM appointments
   WHERE contact_id = p_contact_id
     AND tenant_id  = v_tenant_id
     AND status     = 'no_show'
     AND datetime > now() - INTERVAL '6 months';
  v_score := v_score + LEAST(30, v_recent_no_shows * 12);

  -- 3. Treatment plans abandonados (0..25)
  -- Si la tabla treatment_plans no existe en este deployment, salta el bloque.
  BEGIN
    SELECT COUNT(*) INTO v_abandoned_plans
      FROM treatment_plans
     WHERE contact_id = p_contact_id
       AND tenant_id  = v_tenant_id
       AND status     = 'abandoned';
    v_score := v_score + LEAST(25, v_abandoned_plans * 25);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- 4. Días sin mensaje del paciente — disengagement (0..25)
  SELECT MAX(m.created_at) INTO v_last_msg_at
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
   WHERE cv.contact_id = p_contact_id
     AND m.tenant_id   = v_tenant_id
     AND m.direction   = 'inbound';
  IF v_last_msg_at IS NULL THEN
    v_score := v_score + 10;
  ELSE
    v_days_since_msg := EXTRACT(DAY FROM (now() - v_last_msg_at))::INT;
    v_score := v_score + LEAST(25,
      CASE
        WHEN v_days_since_msg < 30  THEN 0
        WHEN v_days_since_msg < 60  THEN 10
        WHEN v_days_since_msg < 90  THEN 20
        ELSE 25
      END
    );
  END IF;

  -- 5. Encuesta con rating bajo (0..20). Si tabla no existe, skip.
  BEGIN
    SELECT COUNT(*) INTO v_low_survey_count
      FROM survey_responses sr
      JOIN appointments a ON a.id = sr.appointment_id
     WHERE a.contact_id = p_contact_id
       AND a.tenant_id  = v_tenant_id
       AND sr.rating    <= 2
       AND sr.created_at > now() - INTERVAL '6 months';
    v_score := v_score + LEAST(20, v_low_survey_count * 20);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN LEAST(100, v_score);
END;
$$;

COMMENT ON FUNCTION compute_churn_score(UUID) IS
  'Score 0-100 de probabilidad de churn. Multi-signal heuristic. Updated por cron churn-recompute nightly.';

-- Helper RPC que el cron usa para batch update — más eficiente que loop en Node.
CREATE OR REPLACE FUNCTION recompute_churn_scores_for_tenant(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH updated AS (
    UPDATE contacts c
       SET churn_probability = compute_churn_score(c.id)
     WHERE c.tenant_id = p_tenant_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION recompute_churn_scores_for_tenant(UUID) IS
  'Recalcula contacts.churn_probability para todos los contactos de un tenant. Llamado por cron churn-recompute.';
