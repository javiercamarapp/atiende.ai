-- ═══════════════════════════════════════════════════════════════════════════
-- ARCO-S: data deletion audit log + token table
--
-- LFPDPPP requires a complete audit trail of data deletion requests,
-- including who requested it, when, what was deleted, and the legal basis.
-- The data_deletion_log table stores this trail and is NOT deletable by
-- the tenant (no RLS DELETE policy, only INSERT + SELECT).
--
-- The arco_tokens table stores time-limited signed tokens that allow
-- patients (titulares) to request deletion of their own data without
-- needing a Supabase account.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Audit log for data deletion requests
CREATE TABLE IF NOT EXISTS public.data_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL, -- 'tenant_owner' | 'patient_token' | 'admin'
  requester_identifier TEXT NOT NULL, -- email or phone (masked)
  phone_deleted TEXT NOT NULL, -- the phone number whose data was deleted (masked)
  deletion_summary JSONB NOT NULL DEFAULT '{}', -- counts of deleted rows per table
  legal_basis TEXT NOT NULL DEFAULT 'LFPDPPP Art. 36 — derecho de cancelación',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.data_deletion_log ENABLE ROW LEVEL SECURITY;

-- Tenants can only see their own deletion logs, and only INSERT + SELECT (no DELETE/UPDATE)
CREATE POLICY "tenant_insert_own" ON public.data_deletion_log
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_read_own" ON public.data_deletion_log
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

-- 2. ARCO tokens for patient-initiated requests
CREATE TABLE IF NOT EXISTS public.arco_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL, -- blind index of the patient's phone
  token_hash TEXT NOT NULL, -- SHA-256 of the token (we never store the token itself)
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arco_tokens_lookup
  ON public.arco_tokens (token_hash) WHERE used_at IS NULL;

ALTER TABLE public.arco_tokens ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write arco_tokens (patient uses the API, not direct DB)
-- No RLS policies for authenticated users = deny all by default with RLS enabled.
