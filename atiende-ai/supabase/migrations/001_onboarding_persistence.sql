-- ═══════════════════════════════════════════════════════════
-- atiende.ai — ONBOARDING PERSISTENCE MIGRATION
-- Safe to run on a fresh DB OR on top of schema.sql (idempotent)
-- Ejecutar en Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ═══════════════════════════════════════════════════════════
-- 2. ENUMS (created only if not already present)
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE business_type AS ENUM (
    'dental','medical','dermatologist','psychologist','nutritionist',
    'gynecologist','pediatrician','ophthalmologist','restaurant',
    'taqueria','cafe','hotel','real_estate','salon','barbershop',
    'spa','gym','veterinary','pharmacy','school','insurance',
    'mechanic','accountant','florist','optics','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM ('free_trial','basic','pro','premium');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_status AS ENUM (
    'onboarding','testing','active','paused','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- 3. TENANTS (negocios)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  business_type business_type NOT NULL DEFAULT 'other',
  plan plan_type DEFAULT 'free_trial',
  status agent_status DEFAULT 'onboarding',
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT DEFAULT 'Merida',
  state TEXT DEFAULT 'Yucatan',
  -- The 43-vertical enum doesn't match business_type, so the real
  -- vertical slug is stored here under `config.vertical`.
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- If schema.sql was already run before, tenants exists but maybe without
-- the `config` column. Add it safely.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tenants_user ON tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ═══════════════════════════════════════════════════════════
-- 4. ONBOARDING_RESPONSES (cada respuesta del chat conversacional)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step INT NOT NULL,
  question_key TEXT NOT NULL,
  answer JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onb_tenant ON onboarding_responses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onb_tenant_key
  ON onboarding_responses(tenant_id, question_key);

-- ═══════════════════════════════════════════════════════════
-- 5. KNOWLEDGE_CHUNKS (RAG — PDFs/imagenes subidos en el onboarding)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  category TEXT,
  source TEXT DEFAULT 'onboarding',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_chunks(tenant_id, category);

-- HNSW vector index for semantic search. Only creates if pgvector is available.
DO $$ BEGIN
  CREATE INDEX idx_kb_hnsw ON knowledge_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN undefined_object THEN NULL;  -- pgvector not installed
END $$;

-- ═══════════════════════════════════════════════════════════
-- 6. HELPER: get_user_tenant_id() used by RLS policies
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM tenants WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Drop + recreate policies (idempotent)
DROP POLICY IF EXISTS "tenant_own" ON tenants;
CREATE POLICY "tenant_own" ON tenants FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "tenant_data" ON onboarding_responses;
CREATE POLICY "tenant_data" ON onboarding_responses FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "tenant_data" ON knowledge_chunks;
CREATE POLICY "tenant_data" ON knowledge_chunks FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ═══════════════════════════════════════════════════════════
-- 8. UPDATED_AT TRIGGER on tenants
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════
-- Verificacion rapida:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('tenants','onboarding_responses','knowledge_chunks');
-- SELECT policyname, tablename FROM pg_policies
--   WHERE tablename IN ('tenants','onboarding_responses','knowledge_chunks');
