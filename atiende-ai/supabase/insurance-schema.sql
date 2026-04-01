-- ═══════════════════════════════════════════════════════════
-- MÓDULO DE SEGUROS AGÉNTICO: SCHEMA COMPLETO
-- Ejecutar en Supabase SQL Editor
-- Prefijo: ins_ para todas las tablas
-- RLS habilitado en todas las tablas con datos de tenant
-- ═══════════════════════════════════════════════════════════

-- 1. CARRIERS (catálogo de aseguradoras)
CREATE TABLE IF NOT EXISTS ins_carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  portal_url TEXT NOT NULL,
  portal_type TEXT NOT NULL DEFAULT 'browser' CHECK (portal_type IN ('browser', 'api', 'email')),
  supported_lines TEXT[] DEFAULT '{}',
  market_share_auto DECIMAL(5,2) DEFAULT 0,
  avg_response_time_ms INTEGER,
  health_status TEXT DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'degraded', 'down')),
  failure_rate_24h DECIMAL(5,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_health_check TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed: Top 15 aseguradoras México
INSERT INTO ins_carriers (name, slug, portal_url, portal_type, supported_lines, market_share_auto) VALUES
('Qualitas', 'qualitas', 'https://agentes.qualitas.com.mx', 'browser', '{auto}', 32.8),
('GNP Seguros', 'gnp', 'https://intermediarios.gnp.com.mx', 'browser', '{auto,vida,gastos_medicos,hogar,negocio}', 12.5),
('AXA Seguros', 'axa', 'https://distribuidores.axa.com.mx', 'browser', '{auto,vida,gastos_medicos,hogar,negocio}', 8.3),
('HDI Seguros', 'hdi', 'https://portalagentes.hdi.com.mx', 'browser', '{auto,vida,hogar}', 7.1),
('Chubb Seguros', 'chubb', 'https://agentes.chubb.com/mx', 'browser', '{auto,vida,gastos_medicos,hogar,negocio}', 6.8),
('BBVA Seguros', 'bbva', 'https://api.bbva.com', 'api', '{auto,vida,hogar}', 5.2),
('Zurich Seguros', 'zurich', 'https://portalagentes.zurich.com.mx', 'browser', '{auto,negocio}', 4.1),
('Mapfre', 'mapfre', 'https://agentes.mapfre.com.mx', 'browser', '{auto,vida,gastos_medicos,hogar}', 3.8),
('Seguros Atlas', 'atlas', 'https://portal.segurosatlas.com.mx', 'browser', '{auto,vida,hogar}', 3.2),
('AIG Seguros', 'aig', 'https://agentes.aig.com.mx', 'browser', '{auto,vida,negocio}', 2.9),
('Banorte Seguros', 'banorte', 'https://seguros.banorte.com/agentes', 'browser', '{auto,vida,hogar}', 2.7),
('Afirme Seguros', 'afirme', 'https://agentes.afirme.com', 'browser', '{auto,vida}', 2.1),
('SURA', 'sura', 'https://agentes.segurossura.com.mx', 'browser', '{auto,vida,gastos_medicos}', 1.9),
('MetLife', 'metlife', 'https://agentes.metlife.com.mx', 'browser', '{vida,gastos_medicos}', 1.8),
('Allianz', 'allianz', 'https://agentes.allianz.com.mx', 'browser', '{auto,vida,gastos_medicos,hogar}', 1.5)
ON CONFLICT (slug) DO NOTHING;

-- 2. CARRIER CREDENTIALS (encriptadas, por tenant)
CREATE TABLE IF NOT EXISTS ins_carrier_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id) ON DELETE CASCADE,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  agent_number TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login_success TIMESTAMPTZ,
  last_login_error TEXT,
  login_failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, carrier_id)
);

ALTER TABLE ins_carrier_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_creds_policy" ON ins_carrier_credentials
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 3. QUOTE REQUESTS (solicitudes de cotización)
CREATE TABLE IF NOT EXISTS ins_quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID,
  conversation_id UUID,
  insurance_line TEXT NOT NULL CHECK (insurance_line IN ('auto', 'vida', 'gastos_medicos', 'hogar', 'negocio')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validating', 'quoting', 'partial', 'complete', 'expired', 'error')),
  -- Client data
  client_name TEXT NOT NULL,
  client_phone TEXT,
  client_email TEXT,
  client_rfc TEXT,
  client_birthdate DATE,
  client_gender TEXT CHECK (client_gender IN ('M', 'F')),
  client_zip_code TEXT NOT NULL,
  client_state TEXT,
  client_city TEXT,
  -- Vehicle data (auto)
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_version TEXT,
  vehicle_use TEXT DEFAULT 'particular',
  vehicle_vin TEXT,
  coverage_type TEXT DEFAULT 'amplia',
  -- Life/health data
  sum_insured DECIMAL(12,2),
  beneficiaries JSONB,
  gmm_plan_type TEXT,
  gmm_family_members JSONB,
  -- Property data
  property_type TEXT,
  property_value DECIMAL(12,2),
  -- Tracking
  carriers_targeted INTEGER DEFAULT 0,
  carriers_succeeded INTEGER DEFAULT 0,
  carriers_failed INTEGER DEFAULT 0,
  source TEXT DEFAULT 'whatsapp',
  raw_input TEXT,
  extracted_data JSONB,
  started_at TIMESTAMPTZ,
  first_result_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_qr_tenant ON ins_quote_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ins_qr_status ON ins_quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_ins_qr_created ON ins_quote_requests(created_at DESC);

ALTER TABLE ins_quote_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_quotes_policy" ON ins_quote_requests
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 4. QUOTES (cotizaciones individuales por carrier)
CREATE TABLE IF NOT EXISTS ins_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES ins_quote_requests(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'declined', 'error', 'timeout', 'skipped')),
  annual_premium DECIMAL(12,2),
  monthly_premium DECIMAL(12,2),
  quarterly_premium DECIMAL(12,2),
  semiannual_premium DECIMAL(12,2),
  deductible_amount DECIMAL(12,2),
  deductible_percentage DECIMAL(5,2),
  coinsurance_percentage DECIMAL(5,2),
  coverages JSONB,
  quote_number TEXT,
  valid_until DATE,
  pdf_url TEXT,
  screenshot_url TEXT,
  duration_ms INTEGER,
  rank_position INTEGER,
  rank_score DECIMAL(5,2),
  error_message TEXT,
  error_type TEXT,
  retry_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_q_request ON ins_quotes(quote_request_id);
CREATE INDEX IF NOT EXISTS idx_ins_q_tenant ON ins_quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ins_q_status ON ins_quotes(status);

ALTER TABLE ins_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_indiv_quotes_policy" ON ins_quotes
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 5. POLICIES (pólizas emitidas)
CREATE TABLE IF NOT EXISTS ins_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID,
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id),
  quote_id UUID REFERENCES ins_quotes(id),
  policy_number TEXT NOT NULL,
  insurance_line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_payment', 'cancelled', 'expired', 'renewed')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_premium DECIMAL(12,2),
  payment_frequency TEXT DEFAULT 'anual',
  next_payment_date DATE,
  payment_status TEXT DEFAULT 'current',
  risk_data JSONB,
  policy_pdf_url TEXT,
  endorsements JSONB DEFAULT '[]',
  commission_percentage DECIMAL(5,2),
  commission_amount DECIMAL(12,2),
  commission_paid BOOLEAN DEFAULT false,
  auto_renew BOOLEAN DEFAULT true,
  renewal_quote_id UUID,
  renewal_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_pol_tenant ON ins_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ins_pol_end ON ins_policies(end_date);
CREATE INDEX IF NOT EXISTS idx_ins_pol_status ON ins_policies(status);

ALTER TABLE ins_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_policies_policy" ON ins_policies
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 6. POLICY PAYMENTS
CREATE TABLE IF NOT EXISTS ins_policy_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  policy_id UUID NOT NULL REFERENCES ins_policies(id) ON DELETE CASCADE,
  payment_number INTEGER,
  amount DECIMAL(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  verified_from_portal BOOLEAN DEFAULT false,
  portal_check_at TIMESTAMPTZ,
  portal_reference TEXT,
  reminder_sent BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMPTZ,
  overdue_notification_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_pay_policy ON ins_policy_payments(policy_id);
CREATE INDEX IF NOT EXISTS idx_ins_pay_due ON ins_policy_payments(due_date);

ALTER TABLE ins_policy_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_payments_policy" ON ins_policy_payments
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 7. CLAIMS (siniestros)
CREATE TABLE IF NOT EXISTS ins_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  policy_id UUID NOT NULL REFERENCES ins_policies(id),
  contact_id UUID,
  claim_number TEXT,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake', 'submitted', 'in_review', 'approved', 'denied', 'paid')),
  incident_date TIMESTAMPTZ,
  incident_description TEXT,
  incident_location TEXT,
  incident_photos JSONB DEFAULT '[]',
  documents JSONB DEFAULT '[]',
  submitted_to_portal BOOLEAN DEFAULT false,
  portal_submission_at TIMESTAMPTZ,
  portal_claim_reference TEXT,
  estimated_amount DECIMAL(12,2),
  approved_amount DECIMAL(12,2),
  paid_amount DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ins_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_claims_policy" ON ins_claims
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 8. CARRIER HEALTH LOG
CREATE TABLE IF NOT EXISTS ins_carrier_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id),
  check_type TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_health_carrier ON ins_carrier_health_log(carrier_id, created_at DESC);

-- 9. AUTOMATION RUNS (log de ejecuciones de agents)
CREATE TABLE IF NOT EXISTS ins_automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id),
  run_type TEXT NOT NULL,
  reference_id UUID,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failure', 'timeout')),
  skyvern_task_id TEXT,
  steps JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_runs_tenant ON ins_automation_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ins_runs_status ON ins_automation_runs(status);

ALTER TABLE ins_automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_runs_policy" ON ins_automation_runs
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 10. VEHICLE CATALOG (catálogo AMIS)
CREATE TABLE IF NOT EXISTS ins_vehicle_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amis_key TEXT UNIQUE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  version TEXT,
  vehicle_type TEXT,
  engine_cc INTEGER,
  doors INTEGER,
  passengers INTEGER,
  estimated_value DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_veh_brand ON ins_vehicle_catalog(brand, model, year);
CREATE INDEX IF NOT EXISTS idx_ins_veh_amis ON ins_vehicle_catalog(amis_key);

-- 11. ZIP CODE CATALOG (catálogo SEPOMEX)
CREATE TABLE IF NOT EXISTS ins_zip_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zip_code TEXT NOT NULL,
  settlement TEXT,
  municipality TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT,
  zone TEXT,
  risk_zone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_zip ON ins_zip_codes(zip_code);

-- 12. QUOTE CACHE
CREATE TABLE IF NOT EXISTS ins_quote_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  carrier_id UUID NOT NULL REFERENCES ins_carriers(id),
  quote_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ins_cache_key ON ins_quote_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ins_cache_exp ON ins_quote_cache(expires_at);

-- ═══════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════

-- Pólizas próximas a renovar (30 días)
CREATE OR REPLACE VIEW ins_v_near_renewal AS
SELECT p.*, c.name AS carrier_name, c.slug AS carrier_slug,
  (p.end_date - CURRENT_DATE) AS days_to_renewal
FROM ins_policies p
JOIN ins_carriers c ON p.carrier_id = c.id
WHERE p.status = 'active'
  AND (p.end_date - CURRENT_DATE) BETWEEN 0 AND 30
ORDER BY (p.end_date - CURRENT_DATE) ASC;

-- Pagos vencidos
CREATE OR REPLACE VIEW ins_v_overdue_payments AS
SELECT pp.*, p.policy_number, c.name AS carrier_name
FROM ins_policy_payments pp
JOIN ins_policies p ON pp.policy_id = p.id
JOIN ins_carriers c ON p.carrier_id = c.id
WHERE pp.status = 'overdue'
   OR (pp.status = 'pending' AND pp.due_date < CURRENT_DATE)
ORDER BY pp.due_date ASC;

-- Carrier health dashboard
CREATE OR REPLACE VIEW ins_v_carrier_health AS
SELECT c.id, c.name, c.slug, c.health_status, c.failure_rate_24h,
  COUNT(CASE WHEN h.status = 'success' AND h.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS ok_24h,
  COUNT(CASE WHEN h.status != 'success' AND h.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS fail_24h,
  ROUND(AVG(CASE WHEN h.created_at > NOW() - INTERVAL '24 hours' THEN h.response_time_ms END)) AS avg_ms_24h
FROM ins_carriers c
LEFT JOIN ins_carrier_health_log h ON c.id = h.carrier_id
GROUP BY c.id;

-- ═══════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- Cleanup expired cache
CREATE OR REPLACE FUNCTION ins_cleanup_cache() RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM ins_quote_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
