-- ═══════════════════════════════════════════════════════════════════════════
-- Harden multi-tenant RLS helpers (audit finding: Supabase anti-pattern)
--
-- 1. get_user_tenant_id() previously ran as SECURITY INVOKER with no locked
--    search_path. That's the exact anti-pattern Supabase's linter flags: if
--    an attacker ever has a path that calls this function while they control
--    search_path, they can shadow `tenants` / `auth.uid()` with objects in
--    their own schema. Supabase Security Advisors flags this as
--    "function_search_path_mutable". SECURITY DEFINER + SET search_path is
--    the canonical fix, and the function body is read-only (SELECT) so it's
--    safe to elevate.
--
-- 2. Fix two RLS policies that had USING but no WITH CHECK:
--      - webhook_logs: INSERT was allowed with no tenant_id guard, so a
--        compromised service_role context could insert cross-tenant rows.
--      - (marketplace_agents is read-only FOR SELECT — WITH CHECK doesn't
--        apply; it stays as-is.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM public.tenants
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_tenant_id() IS
  'Returns the tenant_id for the currently authenticated user. SECURITY DEFINER with locked search_path — required by Supabase linter and RLS correctness.';

-- Grant execute to authenticated users (RLS policies depend on it).
-- The function body only does a single SELECT constrained to the caller''s
-- own tenant, so elevation is bounded.
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;

-- ─── RLS: webhook_logs missing WITH CHECK ──────────────────────────────────
DROP POLICY IF EXISTS "tenant_data" ON public.webhook_logs;
CREATE POLICY "tenant_data" ON public.webhook_logs FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- ─── Verification queries (run after deploy) ───────────────────────────────
-- 1) Function has SECURITY DEFINER + pinned search_path:
--    SELECT proname, prosecdef, proconfig
--    FROM pg_proc WHERE proname = 'get_user_tenant_id';
--    prosecdef=true, proconfig contains 'search_path=public, pg_temp'
--
-- 2) No tenant-scoped policy missing WITH CHECK:
--    SELECT schemaname, tablename, policyname, cmd, with_check
--    FROM pg_policies
--    WHERE schemaname='public' AND cmd IN ('INSERT','UPDATE','ALL')
--      AND with_check IS NULL;
--    Expected: zero rows (public_read on marketplace_agents is FOR SELECT
--    which doesn't need WITH CHECK).
