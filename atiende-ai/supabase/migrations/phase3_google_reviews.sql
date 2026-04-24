-- Phase 3 — Google Business Profile: review sync
--
-- Importamos reseñas públicas desde Google Places API (campo `reviews` del
-- endpoint place/details). Google devuelve hasta 5 más relevantes (no es
-- API completa — para eso requiere OAuth via Business Profile API, fuera de
-- scope MVP).
--
-- Beneficios:
--   1. El dashboard muestra reseñas sin salir a Google.
--   2. El agente reputacion puede chequear si el paciente ya dejó reseña
--      (evita pedirla de nuevo).
--   3. El dueño tiene histórico aun si la persona luego borra la reseña.
--
-- Nota: la API de Places returns review_id estable sólo si `reviewer_name`
-- + `posted_at` (time) son estables. Usamos HMAC(review_id||tenant_id) como
-- natural key para dedupe.
--
-- IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS google_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id    UUID REFERENCES locations(id) ON DELETE SET NULL,

  -- Dedupe: hash determinístico de (reviewer_name + posted_at + place_id)
  -- para detectar reseñas repetidas entre syncs. Google no expone un ID
  -- estable en el endpoint público así que construimos uno.
  review_key     TEXT NOT NULL,

  reviewer_name  TEXT,
  rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  comment_lang   TEXT,                                  -- 'es' | 'en' | etc
  posted_at      TIMESTAMPTZ NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Acción del dueño — responder reseñas via dashboard (future: push reply
  -- a Google vía Business Profile API una vez que tengamos OAuth).
  owner_replied     BOOLEAN NOT NULL DEFAULT FALSE,
  owner_reply_text  TEXT,
  owner_replied_at  TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, review_key)
);

CREATE INDEX IF NOT EXISTS idx_reviews_tenant_posted
  ON google_reviews (tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_low_rating
  ON google_reviews (tenant_id, rating)
  WHERE rating <= 3;

ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'google_reviews'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON google_reviews FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- Metadata de syncs — cuándo fue el último + cuántas reviews trajo
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS google_reviews_last_sync_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_reviews_last_count    INT;
