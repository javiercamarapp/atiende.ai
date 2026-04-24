-- Phase 1 — agregar campos para los 5 tools nuevos de conversión/compliance.
--
-- - contacts.guardian_*      — tutor legal para pacientes menores
-- - contacts.is_minor + dob  — flag + birth date para validar permisos
-- - contacts.marketing_source + utm_campaign + utm_medium — tracking de lead origin
-- - staff.bio, certifications, experience_years — para retrieve_doctor_expertise
--
-- IDEMPOTENTE. Safe to run múltiples veces.

-- 1. Contacts: guardian (menor de edad) + UTM source
--
-- Nota sobre is_minor:
--   No se puede usar un GENERATED column con CURRENT_DATE — Postgres lo
--   rechaza porque CURRENT_DATE no es IMMUTABLE (cambia cada día). La
--   alternativa canónica es calcular edad on-demand en código desde
--   birth_date. Lo hace el tool `validate_minor_permission` en
--   conversion-tools.ts (y cualquier query server-side puede usar
--   `birth_date > (CURRENT_DATE - INTERVAL '18 years')` en el WHERE).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birth_date          DATE,
  ADD COLUMN IF NOT EXISTS guardian_name       TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone      TEXT,
  ADD COLUMN IF NOT EXISTS guardian_relation   TEXT,  -- 'padre' | 'madre' | 'tutor' | 'otro'
  ADD COLUMN IF NOT EXISTS guardian_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_source    TEXT,  -- 'instagram' | 'google' | 'facebook' | 'referral' | 'whatsapp_direct' | 'other'
  ADD COLUMN IF NOT EXISTS utm_campaign        TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium          TEXT,
  ADD COLUMN IF NOT EXISTS utm_content         TEXT;

-- Para analytics: queries "pacientes por source" van a ser frecuentes
CREATE INDEX IF NOT EXISTS idx_contacts_marketing_source
  ON contacts(tenant_id, marketing_source)
  WHERE marketing_source IS NOT NULL;

-- 2. Staff: bio + experience for retrieve_doctor_expertise
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS bio                 TEXT,           -- 1-3 párrafos
  ADD COLUMN IF NOT EXISTS certifications      TEXT[],         -- ['COFEPRIS-12345', 'Cédula 1234567']
  ADD COLUMN IF NOT EXISTS experience_years    INT,
  ADD COLUMN IF NOT EXISTS procedures          TEXT[],         -- ['implantes', 'ortodoncia', 'blanqueamiento']
  ADD COLUMN IF NOT EXISTS languages           TEXT[] DEFAULT ARRAY['es'];

-- Search por specialty/procedure es el use case clave de retrieve_doctor_expertise.
-- pg_trgm index para LIKE queries sobre bio + procedures.
CREATE INDEX IF NOT EXISTS idx_staff_bio_trgm
  ON staff USING gin (bio gin_trgm_ops)
  WHERE active = TRUE;
