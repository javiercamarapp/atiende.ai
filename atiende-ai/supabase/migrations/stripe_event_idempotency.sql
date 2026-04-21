-- ════════════════════════════════════════════════════════════════════════════
-- STRIPE EVENT IDEMPOTENCY — AUDIT R19 #9
--
-- Problema: el webhook /api/webhook/stripe procesa event.id without dedup.
-- Stripe envía at-least-once — un mismo event.id puede llegar 2+ veces.
-- Cada retry podía disparar el side-effect (activar premium, fetch subscription,
-- actualizar tenant) repetidamente. En el peor caso: double billing local state.
--
-- Fix: tabla processed_stripe_events con UNIQUE(event_id). El webhook hace
-- INSERT ... ON CONFLICT DO NOTHING al inicio. Si la inserción devuelve 0
-- rows afectados → ya fue procesado, return 200 sin hacer nada.
--
-- Retención: 90 días (Stripe retry window < 30 días, margen seguro).
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
  ON processed_stripe_events(processed_at DESC);

-- No RLS — solo service_role escribe/lee. No tiene tenant_id scope porque
-- los events de Stripe son pre-tenant (viene con metadata que debemos parsear).
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- Policy explícitamente denegatoria para authenticated.
DROP POLICY IF EXISTS "no_authenticated_access" ON processed_stripe_events;
CREATE POLICY "no_authenticated_access" ON processed_stripe_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE processed_stripe_events IS
  'AUDIT R19 #9 — idempotency log para Stripe webhook events.';
