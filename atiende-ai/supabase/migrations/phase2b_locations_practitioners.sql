-- Phase 2.B.1 — Multi-location + multi-practitioner
--
-- Hoy el modelo implícito es "1 tenant = 1 clínica = 1 sucursal". Staff
-- (doctores) ya es multi per-tenant, pero no hay concepto de sucursales.
-- El 70% del mercado mexicano de consultorios son clínicas con ≥2
-- doctores y muchas veces ≥2 sucursales (consultorio central + satélite).
-- Sin esto no podemos vender más allá del solo-practitioner.
--
-- Tres piezas nuevas:
--   1. locations — cada sucursal física del tenant (dirección + horarios)
--   2. staff_locations — un doctor puede trabajar en múltiples sucursales
--      (tabla many-to-many)
--   3. appointments.location_id + public_booking_links.location_id — la
--      cita y el link público saben en qué sucursal ocurren
--
-- Back-compat: tenants que no quieren multi-location siguen funcionando
-- sin cambios. Migraciones subsecuentes (2.B.2 ... agenda/tools) leerán
-- location_id como NULL cuando el tenant usa el modo single-location.
--
-- IDEMPOTENTE.

-- 1. LOCATIONS
CREATE TABLE IF NOT EXISTS locations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,            -- "Consultorio Polanco", "Sucursal Satélite"
  address          TEXT,
  city             TEXT,
  state            TEXT,
  country          TEXT DEFAULT 'MX',
  postal_code      TEXT,
  lat              DECIMAL(10, 7),
  lng              DECIMAL(10, 7),
  google_place_id  TEXT,                     -- para map embed + schema.org
  phone            TEXT,
  timezone         TEXT,                     -- override del timezone del tenant si difiere
  business_hours   JSONB DEFAULT '{}'::jsonb, -- mismo formato que tenants.business_hours
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE, -- sede principal (para tenant single-loc default)
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_tenant
  ON locations (tenant_id) WHERE active = TRUE;

-- Un tenant tiene a lo sumo UNA location con is_primary=true — enforzado
-- con índice único parcial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_one_primary
  ON locations (tenant_id) WHERE is_primary = TRUE;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'locations'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON locations FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- 2. STAFF ↔ LOCATIONS (many-to-many)
CREATE TABLE IF NOT EXISTS staff_locations (
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  -- schedule override: si un doctor atiende en 2 locations con horarios
  -- distintos, puede dejar null (usa el business_hours de la location) o
  -- especificar su propio schedule. JSONB con mismo formato que staff.schedule.
  schedule_override JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, location_id)
);

-- Lookups frecuentes: "qué locations atiende este staff" y vice versa
CREATE INDEX IF NOT EXISTS idx_staff_locations_staff
  ON staff_locations (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_locations_location
  ON staff_locations (location_id);

ALTER TABLE staff_locations ENABLE ROW LEVEL SECURITY;

-- staff_locations no tiene tenant_id propio — la autorización se deriva via
-- staff. El policy join es necesario.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_locations'
      AND policyname = 'tenant_data_via_staff'
  ) THEN
    CREATE POLICY "tenant_data_via_staff" ON staff_locations FOR ALL
      USING (
        staff_id IN (SELECT id FROM staff WHERE tenant_id = get_user_tenant_id())
      );
  END IF;
END $$;

-- 3. APPOINTMENTS + PUBLIC_BOOKING_LINKS ← location_id
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apt_location
  ON appointments (tenant_id, location_id, datetime)
  WHERE location_id IS NOT NULL;

ALTER TABLE public_booking_links
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- 4. HELPER VIEW — "locations enriched with staff counts" para UI
CREATE OR REPLACE VIEW locations_with_staff AS
SELECT
  l.id,
  l.tenant_id,
  l.name,
  l.address,
  l.city,
  l.is_primary,
  l.active,
  COUNT(sl.staff_id) FILTER (WHERE s.active = TRUE) AS active_staff_count
FROM locations l
LEFT JOIN staff_locations sl ON sl.location_id = l.id
LEFT JOIN staff s ON s.id = sl.staff_id
GROUP BY l.id;
