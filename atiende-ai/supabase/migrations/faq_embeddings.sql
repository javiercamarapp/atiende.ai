-- ════════════════════════════════════════════════════════════════════════════
-- FAQ EMBEDDINGS — Phase 7.B
--
-- Tabla vectorial para el faq-gap-detector. Cada fila es una pregunta
-- inbound capturada con su embedding (text-embedding-3-small, 1536 dims).
-- Permite clustering con cosine distance (`<=>`) y búsqueda semántica.
--
-- Requiere extensión pgvector. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS faq_embeddings (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_text    TEXT          NOT NULL,
  embedding        vector(1536),
  cluster_id       INTEGER,
  frequency        INTEGER       DEFAULT 1,
  suggested_answer TEXT,
  created_at       TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE faq_embeddings IS
  'Preguntas inbound capturadas por el FAQ gap detector con embeddings para clustering semántico.';

COMMENT ON COLUMN faq_embeddings.embedding IS
  'Embedding 1536-dim de text-embedding-3-small.';

COMMENT ON COLUMN faq_embeddings.cluster_id IS
  'ID de cluster asignado por el detector (populado en el batch run).';

-- Índice para filtrar por tenant
CREATE INDEX IF NOT EXISTS idx_faq_embeddings_tenant
  ON faq_embeddings(tenant_id, created_at DESC);

-- Índice IVFFLAT para búsqueda aproximada (cosine distance)
-- Nota: IVFFLAT requiere al menos 1000 filas para ser óptimo; antes de eso,
-- el scan secuencial es más rápido. pgvector lo maneja transparentemente.
CREATE INDEX IF NOT EXISTS idx_faq_embeddings_vec
  ON faq_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS — mismo patrón que el resto
ALTER TABLE faq_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS faq_embeddings_tenant_isolation ON faq_embeddings;
CREATE POLICY faq_embeddings_tenant_isolation ON faq_embeddings
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
