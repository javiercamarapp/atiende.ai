-- ════════════════════════════════════════════════════════════════════════════
-- CRITICAL ERRORS — audit trail de errores en producción
-- Fallback observability cuando Sentry no está instalado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS critical_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('fatal', 'error', 'warning', 'info')),
  error_name TEXT,
  error_message TEXT,
  error_stack TEXT,
  context JSONB,
  route TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para dashboards (últimos errores + filtro por severity)
CREATE INDEX IF NOT EXISTS idx_critical_errors_recent
  ON critical_errors(created_at DESC, severity);

-- Parcial para alertas en tiempo real (sólo no-resueltos)
CREATE INDEX IF NOT EXISTS idx_critical_errors_unresolved
  ON critical_errors(tenant_id, severity, created_at DESC)
  WHERE resolved = false;

ALTER TABLE critical_errors ENABLE ROW LEVEL SECURITY;

-- Solo service_role escribe; admins leen todo
DROP POLICY IF EXISTS critical_errors_admin_read ON critical_errors;
CREATE POLICY critical_errors_admin_read ON critical_errors
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
  ));

COMMENT ON TABLE critical_errors IS
  'Audit trail de errores críticos de producción. Complementa Sentry (dynamic import via src/lib/observability/error-tracker.ts).';
