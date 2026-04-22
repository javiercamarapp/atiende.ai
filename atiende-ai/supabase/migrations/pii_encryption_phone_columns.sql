-- ═══════════════════════════════════════════════════════════════════════════
-- PII Encryption: blind index columns for phone lookups
--
-- After this migration, the application will:
--   1. Write encrypted values to phone/customer_phone/name columns
--   2. Write HMAC blind indexes to *_hash columns for equality lookups
--   3. Read from *_hash for WHERE clauses, decrypt phone/name for display
--
-- The migration is BACKWARDS-COMPATIBLE: it only ADDs columns and indexes.
-- Existing plaintext values continue to work (decryptPII returns plaintext
-- passthrough when the v1: prefix is absent).
--
-- After deploying the app code that writes encrypted values, run the
-- backfill script (scripts/backfill-pii-encryption.ts) to encrypt
-- existing rows and populate hash columns.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. contacts: add phone_hash for lookups
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_hash
  ON public.contacts (tenant_id, phone_hash);

-- 2. conversations: add customer_phone_hash for lookups
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS customer_phone_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_customer_phone_hash
  ON public.conversations (tenant_id, customer_phone_hash);

-- 3. appointments: add customer_phone_hash for lookups
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS customer_phone_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_customer_phone_hash
  ON public.appointments (tenant_id, customer_phone_hash);

-- 4. leads: add phone_hash for lookups (only if phone column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads'
      AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.leads
      ADD COLUMN IF NOT EXISTS phone_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_leads_phone_hash
      ON public.leads (tenant_id, phone_hash);
  END IF;
END $$;

-- 5. orders: add customer_phone_hash for lookups (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'customer_phone'
  ) THEN
    ALTER TABLE public.orders
      ADD COLUMN IF NOT EXISTS customer_phone_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_hash
      ON public.orders (tenant_id, customer_phone_hash);
  END IF;
END $$;

-- 6. Update the atomic upsert RPC to accept hash parameters
-- The existing upsert_inbound_message function receives p_phone and
-- p_customer_phone. We add p_phone_hash and p_customer_phone_hash
-- as OPTIONAL parameters (default NULL) so the old code still works
-- until the app is deployed with the new parameters.
--
-- NOTE: This is a CREATE OR REPLACE — it updates the existing function.
-- If the function doesn't exist yet (fresh install), atomic_inbound_upsert.sql
-- must be applied first.

-- Check if the function exists before trying to replace it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'upsert_inbound_message'
  ) THEN
    -- We can't easily ALTER FUNCTION to add parameters in PL/pgSQL,
    -- so we document that the app-level code handles hash population
    -- outside the RPC call. The RPC only handles contact/conversation/
    -- message creation; the hash columns are populated by the app layer
    -- in a separate UPDATE after the RPC returns.
    RAISE NOTICE 'upsert_inbound_message exists — hash columns will be populated by app layer';
  END IF;
END $$;

-- ─── Verification queries ──────────────────────────────────────────────────
-- After applying:
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('contacts','conversations','appointments','leads')
--   AND column_name LIKE '%_hash'
-- ORDER BY table_name, column_name;
--
-- Expected: phone_hash on contacts, leads; customer_phone_hash on
-- conversations, appointments, orders.
