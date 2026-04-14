-- ════════════════════════════════════════════════════════════════════════════
-- FINAL HARDENING — Phase 8
--
-- Consolida TODOS los fixes de schema de esta fase de hardening:
--   1. scheduled_messages.next_retry_at + retry_count (backoff exponencial)
--   2. messages.wa_message_id UNIQUE constraint (idempotencia)
--   3. faq_embeddings table con pgvector (si no se aplicó antes)
--   4. conversations.summary + unsatisfied (si no existen)
--
-- Idempotente — safe re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. scheduled_messages retry columns ─────────────────────────────────────

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS retry_count   INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Índice optimizado para la query del cron: pending + scheduled_at pasó + retry listo
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_retry
  ON scheduled_messages(scheduled_at, next_retry_at, status)
  WHERE status = 'pending';

COMMENT ON COLUMN scheduled_messages.next_retry_at IS
  'NULL = primer intento. Si set, espera hasta este momento antes de re-intentar. Backoff 2^n minutos.';

-- ── 2. messages.wa_message_id UNIQUE constraint ─────────────────────────────
-- Meta reintenta webhooks agresivamente. El processor.ts tiene idempotency
-- check a nivel app, pero esto es defensa de DB layer para race conditions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_wa_message_id'
  ) THEN
    -- Primero limpiamos duplicados existentes (si los hay) para que el ALTER no falle
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY wa_message_id ORDER BY created_at ASC) AS rn
          FROM messages
         WHERE wa_message_id IS NOT NULL
      ) dups
      WHERE rn > 1
    );

    ALTER TABLE messages
      ADD CONSTRAINT uniq_wa_message_id
      UNIQUE (wa_message_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Índice para el idempotency check en processor.ts (lookup eficiente)
CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id
  ON messages(wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- ── 3. faq_embeddings (si no se aplicó) ────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_faq_embeddings_tenant
  ON faq_embeddings(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_faq_embeddings_vec
  ON faq_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE faq_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS faq_embeddings_tenant_isolation ON faq_embeddings;
CREATE POLICY faq_embeddings_tenant_isolation ON faq_embeddings
  FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 4. conversations.summary + unsatisfied ──────────────────────────────────

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary     TEXT,
  ADD COLUMN IF NOT EXISTS unsatisfied BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_conversations_unsatisfied
  ON conversations(tenant_id, unsatisfied, last_message_at DESC)
  WHERE unsatisfied = TRUE;
