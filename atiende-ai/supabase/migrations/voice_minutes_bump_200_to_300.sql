-- ════════════════════════════════════════════════════════════════════════════
-- VOICE MINUTES — bump default 200 → 300 minutos
--
-- Contexto de negocio:
--   - Consumo promedio por consultorio observado: ~300 min/mes.
--   - Retell cost real: ~$0.07 USD/min = ~$1.40 MXN/min.
--   - 300 min incluidos × $1.40 = $420 MXN costo → margen bruto 71%
--     sobre $1,499 del plan premium (antes de overage).
--   - Overage a $5 MXN/min cobra $3.60 de margen por minuto extra.
--
-- Cambios:
--   1. voice_usage.minutes_included default: 200 → 300
--   2. Función increment_voice_minutes default p_included: 200 → 300
--   3. Tenants premium EXISTENTES con 200 → subir a 300 (gratis upgrade)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Default de columna (solo aplica a filas futuras)
ALTER TABLE voice_usage
  ALTER COLUMN minutes_included SET DEFAULT 300;

-- 2. Recrear función RPC con nuevo default
CREATE OR REPLACE FUNCTION increment_voice_minutes(
  p_tenant_id UUID,
  p_year_month TEXT,
  p_minutes NUMERIC,
  p_included INTEGER DEFAULT 300
)
RETURNS TABLE(minutes_used NUMERIC, overage_minutes NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO voice_usage(
    tenant_id, year_month, minutes_used, minutes_included, overage_minutes
  )
  VALUES(
    p_tenant_id, p_year_month, p_minutes, p_included,
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
  WHERE vu.tenant_id = p_tenant_id AND vu.year_month = p_year_month;
END;
$$;

-- 3. Upgrade gratis para tenants premium existentes (200 → 300)
UPDATE tenants
SET voice_minutes_included = 300
WHERE plan = 'premium'
  AND voice_minutes_included = 200;

-- 4. Upgrade gratis para voice_usage del mes actual (200 → 300) en tenants premium
UPDATE voice_usage vu
SET minutes_included = 300,
    overage_minutes = GREATEST(0, vu.minutes_used - 300),
    updated_at = NOW()
FROM tenants t
WHERE vu.tenant_id = t.id
  AND t.plan = 'premium'
  AND vu.minutes_included = 200
  AND vu.year_month = to_char(NOW(), 'YYYY-MM');

COMMENT ON FUNCTION increment_voice_minutes IS
  'UPSERT atómico. Default 300 min/mes (bumpeado de 200).';
