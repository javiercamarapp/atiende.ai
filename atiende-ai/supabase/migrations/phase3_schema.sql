-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 3 SCHEMA — 8 patient agents + 6 internal agents + cron infrastructure
--
-- Extiende el schema sobre la base de Phase 2.C (intelligence_p0.sql).
-- Agrupa todas las tablas/columnas/views nuevas que los agentes Phase 3
-- necesitan, organizadas por dominio.
--
-- Idempotente: IF NOT EXISTS en columnas/tablas/índices; OR REPLACE en
-- functions/views; DROP+CREATE en triggers.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. APPOINTMENT lifecycle adicional (POST-CONSULTA, COBRANZA) ────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS pre_visit_sent       BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pre_visit_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_visit_sent      BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS post_visit_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_status       TEXT        DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'waived', 'partial')),
  ADD COLUMN IF NOT EXISTS payment_due_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method       TEXT,
  ADD COLUMN IF NOT EXISTS payment_received_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doctor_notes         TEXT;

COMMENT ON COLUMN appointments.doctor_notes IS
  'Notas clínicas que el doctor envía via WhatsApp post-consulta. Input al agente MEDICAMENTO para parsear prescripciones.';

-- ── 2. CONTACT extensiones (INTAKE, RETENCIÓN, ENCUESTA, REPUTACIÓN) ────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birth_date                  DATE,
  ADD COLUMN IF NOT EXISTS intake_completed            BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intake_completed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_data                 JSONB       DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_satisfaction_rating    TEXT,
  ADD COLUMN IF NOT EXISTS satisfaction_history        JSONB       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_requested            BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_requested_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_retention_contact      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_contact_count     INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reactivated_at              TIMESTAMPTZ;

-- ── 3. TENANT extensiones (REPUTACIÓN, escalation, idiomas) ────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS google_review_url   TEXT,
  ADD COLUMN IF NOT EXISTS digest_enabled      BOOLEAN     DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS digest_day_of_week  INTEGER     DEFAULT 1
    CHECK (digest_day_of_week BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS digest_hour_local   INTEGER     DEFAULT 8
    CHECK (digest_hour_local BETWEEN 0 AND 23);

-- ── 4. survey_responses (ENCUESTA agent) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS survey_responses (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id    UUID          REFERENCES appointments(id) ON DELETE SET NULL,
  patient_phone     TEXT          NOT NULL,
  rating            TEXT          NOT NULL
    CHECK (rating IN ('Excelente', 'Buena', 'Regular', 'Mala')),
  would_recommend   BOOLEAN,
  comment           TEXT,
  sentiment_score   DECIMAL(3, 2)
    CHECK (sentiment_score BETWEEN -1 AND 1),
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveys_tenant_date
  ON survey_responses(tenant_id, created_at DESC);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_responses_isolation ON survey_responses;
CREATE POLICY survey_responses_isolation ON survey_responses
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 5. scheduled_messages (MEDICAMENTO + RETENCIÓN — recordatorios futuros) ─
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_phone   TEXT          NOT NULL,
  message_type    TEXT          NOT NULL
    CHECK (message_type IN ('medication_reminder', 'retention', 'follow_up', 'gap_fill')),
  message_content TEXT          NOT NULL,
  scheduled_at    TIMESTAMPTZ   NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT          DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  retry_count     INTEGER       DEFAULT 0,
  metadata        JSONB         DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_pending_due
  ON scheduled_messages(scheduled_at, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_tenant_phone
  ON scheduled_messages(tenant_id, patient_phone, scheduled_at DESC);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_messages_isolation ON scheduled_messages;
CREATE POLICY scheduled_messages_isolation ON scheduled_messages
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 6. tenant_prompts (ONBOARDING PROMPT GENERATOR — Javier internal) ───────
CREATE TABLE IF NOT EXISTS tenant_prompts (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_name    TEXT          NOT NULL,
  prompt_text   TEXT          NOT NULL,
  model_used    TEXT,
  generated_at  TIMESTAMPTZ   DEFAULT NOW(),
  is_active     BOOLEAN       DEFAULT TRUE,
  UNIQUE (tenant_id, agent_name)
);

-- ── 7. prompt_approval_queue (FINE-TUNING PIPELINE — Javier approves) ──────
CREATE TABLE IF NOT EXISTS prompt_approval_queue (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_name        TEXT          NOT NULL,
  current_prompt    TEXT          NOT NULL,
  proposed_prompt   TEXT          NOT NULL,
  changes_summary   TEXT,
  status            TEXT          DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'deployed')),
  reviewed_at       TIMESTAMPTZ,
  deployed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- ── 8. fraud_alerts (FRAUD DETECTOR — Javier internal) ──────────────────────
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  anomaly_type  TEXT          NOT NULL,
  evidence      TEXT,
  status        TEXT          DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status
  ON fraud_alerts(status, created_at DESC);

-- ── 9. benchmark_metrics (anonimizadas para benchmarking entre tenants) ────
CREATE TABLE IF NOT EXISTS benchmark_metrics (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_type               TEXT          NOT NULL,
  city                        TEXT          NOT NULL,
  month                       DATE          NOT NULL,
  avg_no_show_rate            DECIMAL(5, 2),
  avg_retention_rate          DECIMAL(5, 2),
  avg_appointments_per_month  INTEGER,
  avg_response_time_minutes   INTEGER,
  avg_satisfaction_score      DECIMAL(3, 2),
  consent_given               BOOLEAN       DEFAULT FALSE,
  created_at                  TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (tenant_id, month)
);

-- ── 10. digest_history (WEEKLY DIGEST — registro de envíos) ────────────────
CREATE TABLE IF NOT EXISTS digest_history (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start    DATE          NOT NULL,
  digest_text   TEXT          NOT NULL,
  sent_at       TIMESTAMPTZ   DEFAULT NOW(),
  cost_usd      NUMERIC(10, 6),
  UNIQUE (tenant_id, week_start)
);

-- ── 11. business_health materialized view (refresh por cron horario) ───────

DROP MATERIALIZED VIEW IF EXISTS business_health_current CASCADE;
CREATE MATERIALIZED VIEW business_health_current AS
SELECT
  t.id                                              AS tenant_id,
  t.name                                            AS business_name,
  -- No-show rate últimos 7 días
  ROUND(
    100.0 * COUNT(CASE WHEN a.status = 'no_show'
                       AND a.datetime > NOW() - INTERVAL '7 days'
                       THEN 1 END) /
    NULLIF(COUNT(CASE WHEN a.datetime > NOW() - INTERVAL '7 days' THEN 1 END), 0)
  )::INTEGER                                        AS no_show_rate_7d,
  -- Citas completadas últimos 30 días
  COUNT(CASE WHEN a.status = 'completed'
             AND a.datetime > NOW() - INTERVAL '30 days'
             THEN 1 END)::INTEGER                   AS completed_30d,
  -- Pacientes en riesgo de churn
  (SELECT COUNT(*)::INTEGER FROM contacts c
    WHERE c.tenant_id = t.id AND c.churn_probability > 60
  )                                                 AS patients_at_churn_risk,
  -- Revenue at risk hoy (proxy: sum risk score)
  COALESCE((
    SELECT SUM(
      COALESCE(
        (SELECT AVG(amount)::NUMERIC FROM payments p
          WHERE p.customer_phone = a2.customer_phone
            AND p.tenant_id = a2.tenant_id),
        500.00
      ) * (a2.no_show_risk_score::DECIMAL / 100.0)
    )::NUMERIC(10, 2)
    FROM appointments a2
    WHERE a2.tenant_id = t.id
      AND DATE(a2.datetime AT TIME ZONE 'America/Merida') = CURRENT_DATE
      AND a2.status = 'scheduled'
      AND a2.no_show_risk_score > 50
  ), 0)                                             AS revenue_at_risk_today_mxn,
  -- Health score 0-100
  LEAST(100, GREATEST(0,
    50
    + CASE
        WHEN ROUND(100.0 * COUNT(CASE WHEN a.status = 'no_show'
                                       AND a.datetime > NOW() - INTERVAL '7 days'
                                       THEN 1 END) /
                   NULLIF(COUNT(CASE WHEN a.datetime > NOW() - INTERVAL '7 days' THEN 1 END), 0)
        ) < 10  THEN  20
        WHEN ROUND(100.0 * COUNT(CASE WHEN a.status = 'no_show'
                                       AND a.datetime > NOW() - INTERVAL '7 days'
                                       THEN 1 END) /
                   NULLIF(COUNT(CASE WHEN a.datetime > NOW() - INTERVAL '7 days' THEN 1 END), 0)
        ) < 20  THEN  10
        ELSE          -10
      END
  ))::INTEGER                                       AS health_score,
  NOW()                                             AS calculated_at
FROM tenants t
LEFT JOIN appointments a ON a.tenant_id = t.id
GROUP BY t.id, t.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_health_tenant
  ON business_health_current(tenant_id);

-- Función helper para refresh por cron
CREATE OR REPLACE FUNCTION refresh_business_health()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY business_health_current;
END;
$$ LANGUAGE plpgsql;
