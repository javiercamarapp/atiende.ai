-- Phase 3.C — Triaje clínico
--
-- Tabla para registrar evaluaciones de urgencia que el agente triaje hace
-- pre-consulta. Útil para audit clínico (NOM-004) — todo intercambio
-- clínico debe quedar documentado.
--
-- IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS triage_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- ESI (Emergency Severity Index) compatible: 1=most urgent, 5=least
  -- Usamos 1-4 para simplificar (nivel 5 = informativa, no triage)
  urgency_level   INT NOT NULL CHECK (urgency_level BETWEEN 1 AND 4),
  -- 1 = ER inmediato, 911 / hospital
  -- 2 = urgente <24h, derivar a guardia o cita doctor mismo día
  -- 3 = esta semana, agendar cita pronta
  -- 4 = no urgente, agendar normal

  chief_complaint TEXT NOT NULL,                -- "dolor de muela 8/10 desde ayer"
  symptoms        TEXT[],                       -- array libre, ej ['fiebre 38', 'inflamación']
  duration_hours  INT,                          -- cuánto lleva el síntoma
  pain_scale      INT CHECK (pain_scale BETWEEN 0 AND 10),

  recommendation  TEXT NOT NULL,                -- texto que el bot le dijo al paciente
  escalated_to_doctor BOOLEAN NOT NULL DEFAULT FALSE,
  redirected_to_er    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Disclaimer visible en cada assessment para auditoría legal
  disclaimer_acknowledged BOOLEAN NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triage_contact
  ON triage_assessments (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_triage_tenant_urgent
  ON triage_assessments (tenant_id, created_at DESC)
  WHERE urgency_level <= 2;

ALTER TABLE triage_assessments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'triage_assessments'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON triage_assessments FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
