-- Profile enrichment: permite que cualquier conversación del bot enriquezca
-- el perfil del paciente sin romper intake ni obligar a re-preguntar datos
-- una y otra vez.
--
-- Cubre 5 features nuevas:
--   1. contacts.preferences (JSONB)     — preferencias de comunicación
--   2. contacts.referred_by (UUID)      — tracking de referidos
--   3. contacts.emergency_flag (bool)   — marker "paciente con urgencia activa"
--   4. contact_documents (tabla nueva)  — adjuntos de WhatsApp (imagen/PDF/audio)
--   5. contact_events (tabla nueva)     — log cronológico de interacciones
--                                         (urgencias, referidos, updates de perfil)
-- IDEMPOTENTE. Correr múltiples veces es seguro.

-- 1. Campos nuevos en contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS preferences       JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS referred_by       UUID REFERENCES contacts(id),
  ADD COLUMN IF NOT EXISTS emergency_flag    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emergency_flag_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_referred_by ON contacts(referred_by)
  WHERE referred_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_emergency ON contacts(tenant_id, emergency_flag_at)
  WHERE emergency_flag = TRUE;

-- 2. Documentos (imágenes/PDFs/audios) del paciente
CREATE TABLE IF NOT EXISTS contact_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN (
    'prescription', 'identification', 'lab_result', 'radiograph',
    'insurance_card', 'selfie', 'other_image', 'other_pdf', 'audio_note'
  )),
  wa_media_id     TEXT,        -- Meta media id (válido 5 min, para re-download)
  storage_path    TEXT,        -- ruta dentro de Supabase Storage si se persistió
  mime_type       TEXT,
  size_bytes      INT,
  description     TEXT,        -- descripción generada por LLM (visión)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_docs_contact ON contact_documents(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_docs_tenant  ON contact_documents(tenant_id, created_at DESC);

ALTER TABLE contact_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_documents'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON contact_documents FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- 3. Eventos cronológicos del contacto
CREATE TABLE IF NOT EXISTS contact_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,  -- 'profile_updated' | 'urgency_escalated' | 'referral_created' | 'document_uploaded' | 'preference_saved'
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_events ON contact_events(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_events_urgency
  ON contact_events(tenant_id, created_at DESC)
  WHERE event_type = 'urgency_escalated';

ALTER TABLE contact_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_events'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON contact_events FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
