-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: appointment_waitlist
-- Renombrado de `waitlist` → `appointment_waitlist` para no colisionar con
-- la tabla `waitlist` legacy del landing page (que captura leads
-- pre-launch con columnas business_type, email, phone, name, raw_input).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone    TEXT NOT NULL,
  customer_name     TEXT,
  service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
  staff_id          UUID REFERENCES staff(id) ON DELETE SET NULL,
  preferred_date_from   DATE,
  preferred_date_to     DATE,
  preferred_time_window TEXT,
  duration_minutes  INT DEFAULT 30,
  status            TEXT DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'expired', 'cancelled')),
  notes             TEXT,
  notified_count    INT DEFAULT 0,
  last_notified_at  TIMESTAMPTZ,
  fulfilled_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  expires_at        TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_waitlist_active
  ON appointment_waitlist (tenant_id, status, preferred_date_from)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_appt_waitlist_contact
  ON appointment_waitlist (tenant_id, contact_id, status);

CREATE INDEX IF NOT EXISTS idx_appt_waitlist_expires
  ON appointment_waitlist (expires_at)
  WHERE status = 'active';

ALTER TABLE appointment_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_appt_waitlist" ON appointment_waitlist;
CREATE POLICY "tenant_appt_waitlist" ON appointment_waitlist FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()))
  WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));

COMMENT ON TABLE appointment_waitlist IS
  'Lista de espera de citas. Pacientes que querían agendar pero no había slot. Tabla separada de "waitlist" (que es de leads pre-launch del landing page).';
