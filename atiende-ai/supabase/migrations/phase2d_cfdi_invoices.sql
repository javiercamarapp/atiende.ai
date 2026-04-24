-- Phase 2.D — Facturación fiscal (CFDI) de consultas
--
-- El schema actual tiene `payments` para trackear cobros pero no hay una
-- tabla dedicada al comprobante fiscal (CFDI) que el SAT exige para
-- negocios que emiten recibos de honorarios. Sin esto los consultorios
-- no pueden automatizar su contabilidad y pagan manual a su contador.
--
-- Integramos Facturapi (SaaS mexicano que expone API REST para generar
-- CFDI 4.0 firmados). El tenant configura su API key en tenants y al
-- emitir, pasamos RFC + datos fiscales + monto. Facturapi nos devuelve
-- cfdi_uuid (folio fiscal) + links al XML + PDF.
--
-- IDEMPOTENTE.

-- Config fiscal por tenant
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS facturapi_api_key        TEXT, -- server-only, NEVER exponer al frontend
  ADD COLUMN IF NOT EXISTS legal_business_name      TEXT,
  ADD COLUMN IF NOT EXISTS legal_rfc                TEXT, -- RFC del tenant (no del paciente)
  ADD COLUMN IF NOT EXISTS legal_tax_regime         TEXT, -- "605" = personas físicas con honorarios, etc.
  ADD COLUMN IF NOT EXISTS legal_address            TEXT,
  ADD COLUMN IF NOT EXISTS legal_postal_code        TEXT,
  ADD COLUMN IF NOT EXISTS cfdi_default_use         TEXT DEFAULT 'G03'; -- G03 = gastos en general, D01 = honorarios médicos

CREATE TABLE IF NOT EXISTS invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id     UUID REFERENCES appointments(id) ON DELETE SET NULL,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Datos del receptor (paciente o su empresa)
  receiver_rfc       TEXT NOT NULL,
  receiver_name      TEXT,          -- razón social si persona moral
  receiver_email     TEXT,
  receiver_postal_code TEXT,
  cfdi_use           TEXT NOT NULL DEFAULT 'G03',

  -- Datos del CFDI emitido
  amount_mxn         DECIMAL(10, 2) NOT NULL,
  description        TEXT,          -- "Consulta dental 15/abr/2026"

  -- IDs externos (Facturapi / SAT)
  provider           TEXT NOT NULL DEFAULT 'facturapi', -- 'facturapi' | 'manual'
  provider_invoice_id TEXT,         -- id interno de Facturapi
  cfdi_uuid          TEXT,          -- Folio Fiscal del SAT (36 chars)
  xml_url            TEXT,
  pdf_url            TEXT,

  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'issued', 'cancelled', 'failed')),
  error_message      TEXT,

  issued_at          TIMESTAMPTZ,
  sent_to_patient_at TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status
  ON invoices (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_appointment
  ON invoices (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_cfdi_uuid
  ON invoices (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoices'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON invoices FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
