-- ════════════════════════════════════════════════════════════════════════════
-- TENANT HOLIDAYS — Phase 12
-- Tabla por tenant para excepciones de fechas (festivos MX, vacaciones, etc).
-- check_availability consulta esta tabla antes de retornar slots.
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_holidays (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date        DATE          NOT NULL,
  reason      TEXT          NOT NULL DEFAULT 'Día festivo',
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tenant_holidays_lookup
  ON tenant_holidays(tenant_id, date);

ALTER TABLE tenant_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_holidays_isolation ON tenant_holidays;
CREATE POLICY tenant_holidays_isolation ON tenant_holidays
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
