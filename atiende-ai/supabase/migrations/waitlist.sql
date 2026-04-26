-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: waitlist
-- Tabla y RLS para lista de espera de citas. Cuando un paciente quiere
-- agendar pero el slot está ocupado, el agente lo agrega a esta tabla.
-- Cuando otra cita se cancela, el cron `runOptimizador` busca matches
-- en la waitlist y notifica al paciente con prioridad FIFO.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS waitlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone    TEXT NOT NULL,
  customer_name     TEXT,
  service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
  staff_id          UUID REFERENCES staff(id) ON DELETE SET NULL,
  -- Preferencias del paciente para el slot que busca
  preferred_date_from   DATE,            -- desde cuándo acepta (NULL = inmediato)
  preferred_date_to     DATE,            -- hasta cuándo acepta (NULL = sin límite)
  preferred_time_window TEXT,            -- 'morning' | 'afternoon' | 'evening' | 'any'
  duration_minutes  INT DEFAULT 30,
  -- Tracking
  status            TEXT DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'expired', 'cancelled')),
  notes             TEXT,
  notified_count    INT DEFAULT 0,       -- cuántas veces se le ofreció un slot
  last_notified_at  TIMESTAMPTZ,
  fulfilled_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  expires_at        TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Index 1: el cron busca por tenant + status='active' + ventana de fechas
CREATE INDEX IF NOT EXISTS idx_waitlist_active
  ON waitlist (tenant_id, status, preferred_date_from)
  WHERE status = 'active';

-- Index 2: query por contact para deduplicar (paciente ya en waitlist)
CREATE INDEX IF NOT EXISTS idx_waitlist_contact
  ON waitlist (tenant_id, contact_id, status);

-- Index 3: cron de expiration
CREATE INDEX IF NOT EXISTS idx_waitlist_expires
  ON waitlist (expires_at)
  WHERE status = 'active';

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_waitlist" ON waitlist;
CREATE POLICY "tenant_waitlist" ON waitlist FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()))
  WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));

COMMENT ON TABLE waitlist IS
  'Lista de espera de citas. Pacientes que querían agendar pero no había slot. Cuando otra cita se cancela, el cron busca el primer match (FIFO con preferencias) y le envía notificación por WhatsApp.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr después del apply)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'waitlist' ORDER BY ordinal_position;
