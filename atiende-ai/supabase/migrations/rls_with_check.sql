-- ════════════════════════════════════════════════════════════════════════════
-- RLS WITH CHECK — defensive explicit policy clauses (AUDIT R18)
--
-- Motivación: el audit R18 señaló que las policies RLS tenían solo `USING`
-- sin `WITH CHECK` explícito. En Postgres `FOR ALL USING ...` sí aplica la
-- expresión también a INSERT/UPDATE new-rows (comportamiento documentado),
-- pero ser EXPLÍCITO es buena práctica defensiva:
--   - Ninguna lectura ambigua del código por parte de auditores.
--   - Si en el futuro cambiamos a `FOR SELECT` / `FOR INSERT` por separado,
--     el comportamiento de WITH CHECK queda claramente definido.
--   - Cumple con recomendación oficial de Supabase.
--
-- Esta migración hace DROP + CREATE para cada policy tenant-scoped porque
-- `ALTER POLICY ... ADD WITH CHECK` NO existe en Postgres.
-- Idempotente — `DROP POLICY IF EXISTS` no falla si ya fue removida.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'staff', 'services', 'contacts', 'conversations', 'messages',
    'appointments', 'orders', 'leads', 'voice_calls', 'knowledge_chunks',
    'daily_analytics', 'tenant_agents', 'onboarding_responses',
    'voice_usage', 'voice_call_logs', 'faq_embeddings', 'fraud_alerts',
    'tool_call_logs', 'audit_log', 'critical_errors', 'tenant_holidays',
    'metrics', 'payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Solo procesar tablas que existan (algunas son opcionales según fase)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_data', t);
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL ' ||
        'USING (tenant_id = get_user_tenant_id()) ' ||
        'WITH CHECK (tenant_id = get_user_tenant_id())',
        'tenant_data', t
      );
    END IF;
  END LOOP;
END $$;

-- Tenants table usa user_id (no tenant_id). Misma lógica defensiva.
DROP POLICY IF EXISTS "tenant_own" ON tenants;
CREATE POLICY "tenant_own" ON tenants
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
