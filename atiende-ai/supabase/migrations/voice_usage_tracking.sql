-- ════════════════════════════════════════════════════════════════════════════
-- VOICE USAGE TRACKING — billing por minutos de voz + overage metered
--
-- Modelo de negocio:
--   - Plan premium ($1,499 MXN/mes) incluye 200 minutos de voz.
--   - Minutos 201+ se cobran a $5 MXN/min vía Stripe metered billing.
--   - Un cron mensual (1er día del mes, 8am) reporta el overage del mes
--     anterior a Stripe para generar la factura complementaria.
--
-- Tablas:
--   voice_usage         — agregado mensual por tenant (1 fila × tenant × mes)
--   voice_call_logs     — log individual de cada llamada (audit trail)
--
-- Función:
--   increment_voice_minutes() — UPSERT atómico para evitar race conditions
--     cuando varias llamadas terminan simultáneamente.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Tabla 1: voice_usage (agregado mensual) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL, -- 'YYYY-MM'
  minutes_used NUMERIC(10,2) DEFAULT 0,
  minutes_included INTEGER DEFAULT 200,
  overage_minutes NUMERIC(10,2) DEFAULT 0,
  overage_billed BOOLEAN DEFAULT FALSE,
  overage_billed_at TIMESTAMPTZ,
  stripe_usage_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_voice_usage_tenant_month
  ON voice_usage(tenant_id, year_month DESC);

CREATE INDEX IF NOT EXISTS idx_voice_usage_overage_pending
  ON voice_usage(year_month)
  WHERE overage_minutes > 0 AND overage_billed = FALSE;

COMMENT ON TABLE voice_usage IS
  'Agregado mensual de minutos de voz por tenant. Un solo row por (tenant, mes).';

-- ─── Tabla 2: voice_call_logs (audit trail) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  retell_call_id TEXT UNIQUE,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  duration_minutes NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_overage BOOLEAN DEFAULT FALSE,
  year_month TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_logs_tenant
  ON voice_call_logs(tenant_id, year_month DESC);

COMMENT ON TABLE voice_call_logs IS
  'Log individual de cada llamada Retell para audit + debugging.';

-- ─── Columnas nuevas en tenants ──────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS voice_minutes_included INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_voice_id TEXT;

COMMENT ON COLUMN tenants.voice_minutes_included IS
  '0=sin voz, 200=plan premium, 99999=enterprise unlimited';
COMMENT ON COLUMN tenants.stripe_subscription_item_voice_id IS
  'Stripe subscription_item.id del price metered de overage de voz. Se popula al hacer checkout del plan premium.';

-- ─── Función atómica increment_voice_minutes ─────────────────────────────────
CREATE OR REPLACE FUNCTION increment_voice_minutes(
  p_tenant_id UUID,
  p_year_month TEXT,
  p_minutes NUMERIC,
  p_included INTEGER DEFAULT 200
)
RETURNS TABLE(
  minutes_used NUMERIC,
  overage_minutes NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO voice_usage(
    tenant_id, year_month, minutes_used,
    minutes_included, overage_minutes
  )
  VALUES(
    p_tenant_id, p_year_month, p_minutes,
    p_included,
    GREATEST(0, p_minutes - p_included)
  )
  ON CONFLICT (tenant_id, year_month) DO UPDATE SET
    minutes_used = voice_usage.minutes_used + p_minutes,
    overage_minutes = GREATEST(
      0,
      (voice_usage.minutes_used + p_minutes) - voice_usage.minutes_included
    ),
    updated_at = NOW();

  RETURN QUERY
  SELECT vu.minutes_used, vu.overage_minutes
  FROM voice_usage vu
  WHERE vu.tenant_id = p_tenant_id
    AND vu.year_month = p_year_month;
END;
$$;

COMMENT ON FUNCTION increment_voice_minutes IS
  'UPSERT atómico que evita race conditions cuando varias llamadas terminan al mismo tiempo. Retorna el total del mes + overage tras el incremento.';

-- RLS: service_role bypasa; usamos supabaseAdmin en el tracker
ALTER TABLE voice_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_call_logs ENABLE ROW LEVEL SECURITY;

-- Permitir a los dueños de tenants leer su propio uso desde el dashboard
DROP POLICY IF EXISTS voice_usage_tenant_read ON voice_usage;
CREATE POLICY voice_usage_tenant_read ON voice_usage
  FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS voice_call_logs_tenant_read ON voice_call_logs;
CREATE POLICY voice_call_logs_tenant_read ON voice_call_logs
  FOR SELECT USING (tenant_id = get_user_tenant_id());
