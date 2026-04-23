-- ════════════════════════════════════════════════════════════════════════════
-- RLS POLICY UPGRADE — migrate from get_user_tenant_id() to get_user_tenant_ids()
--
-- The old helper uses LIMIT 1 which returns an arbitrary tenant_id if a user
-- ever ends up with multiple tenants. The new helper returns an array and
-- uses = ANY(...) which is future-proof for multi-location support.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  policy_name TEXT;
  tenant_tables TEXT[] := ARRAY[
    'staff',
    'services',
    'contacts',
    'conversations',
    'messages',
    'appointments',
    'orders',
    'leads',
    'voice_calls',
    'knowledge_chunks',
    'daily_analytics',
    'tenant_agents',
    'onboarding_responses',
    'webhook_logs',
    'agent_versions',
    'classification_feedback',
    'agent_executions',
    'metrics_snapshots'
  ];
  -- Policy names match the ones created in schema.sql and rls_with_check.sql
  policy_names TEXT[] := ARRAY[
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_data',
    'tenant_agent_versions',
    'tenant_classification_feedback',
    'tenant_agent_executions',
    'tenant_metrics_snapshots'
  ];
BEGIN
  FOR i IN 1..array_length(tenant_tables, 1) LOOP
    tbl := tenant_tables[i];
    policy_name := policy_names[i];

    -- Skip tables that don't exist (e.g. not yet created)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Skipping % — table does not exist', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL ' ||
      'USING (tenant_id = ANY(get_user_tenant_ids())) ' ||
      'WITH CHECK (tenant_id = ANY(get_user_tenant_ids()))',
      policy_name, tbl
    );
    RAISE NOTICE 'Upgraded policy % on %', policy_name, tbl;
  END LOOP;
END $$;

-- Also handle tool_call_logs (from tool_calling_setup.sql)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_call_logs'
  ) THEN
    DROP POLICY IF EXISTS "tenant_tool_call_logs" ON tool_call_logs;
    CREATE POLICY "tenant_tool_call_logs" ON tool_call_logs FOR ALL
      USING (tenant_id = ANY(get_user_tenant_ids()))
      WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));
  END IF;
END $$;

-- Handle faq_embeddings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'faq_embeddings'
  ) THEN
    DROP POLICY IF EXISTS "tenant_faq_embeddings" ON faq_embeddings;
    CREATE POLICY "tenant_faq_embeddings" ON faq_embeddings FOR ALL
      USING (tenant_id = ANY(get_user_tenant_ids()))
      WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));
  END IF;
END $$;
