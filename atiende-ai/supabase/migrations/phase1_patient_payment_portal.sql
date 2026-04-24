-- Phase 1 — Patient Payment Portal
--
-- El paciente recibe un link de Stripe Checkout por WhatsApp y paga online.
-- Columns que agregamos para trackear:
--   - payment_amount_mxn: monto del cobro (puede diferir del service price
--     si se aplica descuento o es un anticipo)
--   - stripe_checkout_session_id: para idempotency y reconciliar con webhook
--   - payment_link_url: Stripe-hosted checkout URL (válido ~24h)
--   - payment_link_created_at: cuando se generó el link
--
-- Las columnas básicas (payment_status, payment_due_date, payment_method,
-- payment_received_at) ya existen desde phase3_schema.sql.
--
-- IDEMPOTENTE.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_amount_mxn         DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_url           TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_created_at    TIMESTAMPTZ;

-- Lookup rápido desde el Stripe webhook: "session_id X ¿a qué cita pertenece?"
CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_stripe_session
  ON appointments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Queries "citas con pago pendiente" del no-show agent y del dashboard:
CREATE INDEX IF NOT EXISTS idx_apt_pending_payment
  ON appointments (tenant_id, datetime)
  WHERE payment_status = 'pending' AND datetime > now();
