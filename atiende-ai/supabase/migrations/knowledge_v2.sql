-- Knowledge v2: zone-based conversational experience
-- Adds metadata trazability to knowledge_chunks so save-answer can update
-- chunks by question_key atomically. Creates review_candidates and
-- insight_cache to power the Conversation Review widget and the Smart
-- Insight card. Extends tenants with sub_vertical + last_review_detection_at.

-- 1. knowledge_chunks.metadata
-- Stores { question_key?, zone?, ... } for chunks ingested from the quiz,
-- report-correction, or doc uploads. DELETE+INSERT by metadata key replaces
-- stale chunks without touching unrelated sources.
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

-- Expression index critical for save-answer: DELETE WHERE tenant_id=?
-- AND source=? AND metadata->>'question_key'=? runs on every quiz answer.
-- Without it a 50k-chunk tenant would table-scan.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_source_qkey
  ON knowledge_chunks (tenant_id, source, (metadata->>'question_key'));

-- 2. tenants.sub_vertical + last_review_detection_at
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sub_vertical TEXT[] DEFAULT '{}'::text[];
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS last_review_detection_at TIMESTAMPTZ;

-- 3. review_candidates
-- Conversations where the bot hesitated. Populated by detect-review-candidates
-- weekly job. Owner resolves via the Conversation Review widget.
CREATE TABLE IF NOT EXISTS review_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_message TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  detection_reason TEXT NOT NULL,
  reviewed BOOLEAN DEFAULT FALSE,
  corrected_response TEXT,
  saved_as_faq BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_candidates_tenant_reviewed
  ON review_candidates (tenant_id, reviewed, created_at DESC);

ALTER TABLE review_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_data" ON review_candidates FOR ALL
USING (tenant_id = get_user_tenant_id())
WITH CHECK (tenant_id = get_user_tenant_id());

-- 4. insight_cache
-- Global cache (no RLS, no tenant_id) keyed by deterministic cache_key derived
-- from business_type + question_key + answer_hash. 7-day TTL cuts ~90% of
-- smart-insight LLM calls. Safe to share: insight text never references the
-- calling tenant.
CREATE TABLE IF NOT EXISTS insight_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insight_cache_expires
  ON insight_cache (expires_at);
