-- Phase 3 — Insurance claims tracking
--
-- En México, seguros de gastos médicos mayores (GNP, AXA, Metlife, BUPA,
-- Seguros Monterrey) reembolsan al paciente tras presentar receipt + CFDI +
-- notas médicas. El pain point: el paciente pierde trazabilidad de qué
-- reclamo va por qué, y el consultorio pierde revenue cuando cobra directo
-- a aseguradora y ésta demora 30-60 días.
--
-- Este schema permite:
--   1. Registrar un claim por cita (reimbursement) o multi-cita (paquete)
--   2. Trackear status (pending_submission → submitted → in_review →
--      approved/denied/partial → paid)
--   3. Notificar al paciente cuando su reembolso está aprobado
--   4. Recordarle al dueño seguir los claims con direct_billing
--
-- IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS insurance_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,

  insurer_name      TEXT NOT NULL,                       -- 'GNP', 'AXA', 'Metlife', 'BUPA', 'Seguros Monterrey', 'IMSS', 'ISSSTE', 'otro'
  policy_number     TEXT,                                -- número de póliza del paciente
  claim_number      TEXT,                                -- número de siniestro emitido por la aseguradora
  direct_billing    BOOLEAN NOT NULL DEFAULT FALSE,      -- true = consultorio cobra directo; false = paciente paga + reembolso

  amount_claimed_mxn  DECIMAL(10, 2),                    -- monto que se reclamó
  amount_paid_mxn     DECIMAL(10, 2),                    -- monto que finalmente pagó la aseguradora
  deductible_mxn      DECIMAL(10, 2),                    -- deducible que quedó a cuenta del paciente

  status            TEXT NOT NULL DEFAULT 'pending_submission'
    CHECK (status IN (
      'pending_submission',    -- paciente juntando docs / consultorio prepara paquete
      'submitted',             -- enviado a la aseguradora
      'in_review',             -- aseguradora analizando
      'approved',              -- autorizado, esperando pago
      'denied',                -- rechazado
      'partial',               -- aprobación parcial
      'paid'                   -- reembolso recibido
    )),

  denial_reason     TEXT,                                 -- si status='denied' o 'partial'
  notes             TEXT,

  submitted_at      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,                          -- cuando quedó approved/denied/paid

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_claims_contact
  ON insurance_claims (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_tenant_status
  ON insurance_claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_pending
  ON insurance_claims (tenant_id, submitted_at)
  WHERE status IN ('submitted', 'in_review');
CREATE INDEX IF NOT EXISTS idx_insurance_claims_direct
  ON insurance_claims (tenant_id, direct_billing)
  WHERE direct_billing = TRUE AND status NOT IN ('paid', 'denied');

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'insurance_claims'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON insurance_claims FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
