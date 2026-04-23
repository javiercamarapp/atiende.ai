-- ════════════════════════════════════════════════════════════════════════════
-- HYBRID SEARCH — pgvector (semantic) + tsvector (lexical BM25-like)
--
-- Problema: threshold 0.35 de coseno puro sufre con queries cortas en español.
-- "cita muela" vs chunk "extracción dental" → similarity baja, chunk descartado.
--
-- Solución: combinar embeddings (entiende semántica) + ts_vector (lexical
-- match perfect en términos raros). La función search_knowledge_hybrid
-- fusiona ambos rankings con Reciprocal Rank Fusion (RRF).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Columna de texto-search (generada desde content)
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', COALESCE(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
  ON knowledge_chunks USING GIN(content_tsv);

-- 2. RPC hybrid_search con Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION search_knowledge_hybrid(
  p_tenant UUID,
  p_query vector(1536),
  p_query_text TEXT,
  p_threshold FLOAT DEFAULT 0.30,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  content TEXT,
  category TEXT,
  similarity FLOAT,
  rrf_score FLOAT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  k_rrf CONSTANT INT := 60; -- constante estándar para RRF
BEGIN
  RETURN QUERY
  WITH vector_search AS (
    SELECT
      kc.content,
      kc.category,
      1 - (kc.embedding <=> p_query) AS sim,
      ROW_NUMBER() OVER (ORDER BY kc.embedding <=> p_query ASC) AS rank
    FROM knowledge_chunks kc
    WHERE kc.tenant_id = p_tenant
      AND (1 - (kc.embedding <=> p_query)) >= p_threshold
    LIMIT p_limit * 2
  ),
  lexical_search AS (
    SELECT
      kc.content,
      kc.category,
      ts_rank(kc.content_tsv, plainto_tsquery('spanish', p_query_text)) AS ts_sim,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank(kc.content_tsv, plainto_tsquery('spanish', p_query_text)) DESC
      ) AS rank
    FROM knowledge_chunks kc
    WHERE kc.tenant_id = p_tenant
      AND kc.content_tsv @@ plainto_tsquery('spanish', p_query_text)
    LIMIT p_limit * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.content, l.content) AS content,
      COALESCE(v.category, l.category) AS category,
      COALESCE(v.sim, 0) AS similarity,
      -- Reciprocal Rank Fusion: suma de 1/(k + rank) de cada fuente
      (
        COALESCE(1.0 / (k_rrf + v.rank), 0) +
        COALESCE(1.0 / (k_rrf + l.rank), 0)
      ) AS rrf_score
    FROM vector_search v
    FULL OUTER JOIN lexical_search l ON v.content = l.content
  )
  SELECT c.content, c.category, c.similarity, c.rrf_score
  FROM combined c
  WHERE c.content IS NOT NULL
  ORDER BY c.rrf_score DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_knowledge_hybrid IS
  'Hybrid search: pgvector semantic + tsvector lexical fusionados con RRF (k=60).
   Mejor recall que vector-only para queries cortas en español.';

GRANT EXECUTE ON FUNCTION search_knowledge_hybrid TO authenticated, anon, service_role;
