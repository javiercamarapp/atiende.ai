-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: multi_user_per_tenant
-- Convierte el modelo de "owner único + staff como recurso" a
-- "multi-user con roles y per-doctor billing".
--
-- Cambios:
--   - staff.user_id → linkea con auth.users (cada doctor tiene su propio login)
--   - staff.role → 'owner' | 'admin' | 'doctor' | 'receptionist'
--   - staff.is_billable → solo doctores cuentan para el seat-based billing
--   - staff.stripe_customer_id + stripe_subscription_id → cada doctor paga
--     su propia suscripción
--   - staff.plan + trial_ends_at → per-doctor plan (B model: cada uno elige)
--   - staff.invited_by + invited_at → audit del invite flow
--   - tenants.account_type → 'personal' (1 doctor) | 'consultorio' (multi)
--
--   - staff_invitations table → tokens de invitación pendientes de aceptar
--
-- RLS actualizada: cada doctor ve SUS citas; owner ve todo del tenant.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Tenants: account_type ───────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'personal'
    CHECK (account_type IN ('personal', 'consultorio'));

-- Tenants existentes con 2+ staff activos → consultorio. El resto → personal.
UPDATE tenants
SET account_type = 'consultorio'
WHERE id IN (
  SELECT tenant_id FROM staff WHERE active = true
  GROUP BY tenant_id HAVING COUNT(*) >= 2
)
AND account_type = 'personal';

-- ─── 2. Staff: multi-user fields ────────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'doctor'
    CHECK (role IN ('owner', 'admin', 'doctor', 'receptionist')),
  -- Solo doctores y staff facturable cuentan para billing
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT true,
  -- Per-doctor billing fields
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trialing'
    CHECK (plan IN ('trialing', 'esencial', 'pro', 'ultimate', 'cancelled')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'unpaid')),
  -- Audit del invite
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Index para lookups rápidos por user_id (cada request de un doctor logueado
-- busca SU staff row para resolver tenant + permisos)
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id) WHERE user_id IS NOT NULL;

-- Index para queries de billing (cron de trial-warning, churn, etc)
CREATE INDEX IF NOT EXISTS idx_staff_subscription
  ON staff(subscription_status, trial_ends_at)
  WHERE is_billable = true;

-- Backfill: el owner del tenant existente queda como 'owner' role.
-- Buscamos cada tenant.user_id y lo linkeamos a un staff existente o creamos uno.
DO $$
DECLARE
  t RECORD;
  existing_staff_id UUID;
  owner_email TEXT;
BEGIN
  FOR t IN SELECT id, user_id, name FROM tenants WHERE user_id IS NOT NULL
  LOOP
    -- Si ya hay un staff sin user_id, asumimos que el owner es ese (típicamente
    -- el primero que crearon). Si hay 2+ staff sin user_id, queda manual.
    SELECT id INTO existing_staff_id
    FROM staff
    WHERE tenant_id = t.id AND user_id IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT email INTO owner_email FROM auth.users WHERE id = t.user_id;

    IF existing_staff_id IS NOT NULL THEN
      UPDATE staff
      SET user_id = t.user_id,
          role = 'owner',
          is_billable = true,
          accepted_at = COALESCE(accepted_at, created_at)
      WHERE id = existing_staff_id;
    END IF;
  END LOOP;
END $$;

-- ─── 3. Tabla de invitations pendientes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'doctor'
    CHECK (role IN ('owner', 'admin', 'doctor', 'receptionist')),
  speciality TEXT,
  -- Token cifrado por SHA-256 para evitar leak por DB dump
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token
  ON staff_invitations(token_hash) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_invitations_tenant
  ON staff_invitations(tenant_id, accepted_at);

ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manages_invitations" ON staff_invitations;
CREATE POLICY "owner_manages_invitations" ON staff_invitations FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()))
  WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));

COMMENT ON TABLE staff_invitations IS
  'Tokens de invitación enviados por email a futuros staff (doctores, recepcionistas, admin). El invitado clickea el link, completa registro y queda linkeado a staff.user_id.';

-- ─── 4. Helper RPC: get_user_staff() ────────────────────────────────────────
-- Devuelve el row de staff del usuario autenticado. Útil para que las RLS
-- policies y el frontend puedan saber rápido el rol + tenant del user.
CREATE OR REPLACE FUNCTION get_user_staff()
RETURNS TABLE (
  staff_id UUID,
  tenant_id UUID,
  role TEXT,
  name TEXT,
  is_billable BOOLEAN,
  plan TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, role, name, is_billable, plan
  FROM public.staff
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- ─── 5. RLS de appointments: doctores ven SUS citas ────────────────────────
-- ANTES: cualquier usuario del tenant veía TODAS las citas.
-- AHORA: doctores solo ven sus propias citas; owners/admin/recepcionistas
-- ven todas las del tenant. Receptionist puede modificar pero no eliminar
-- (ese check va en application-level, no en RLS).
DROP POLICY IF EXISTS "tenant_data" ON appointments;
CREATE POLICY "appointments_role_based" ON appointments FOR ALL
  USING (
    tenant_id = ANY(get_user_tenant_ids())
    AND (
      -- Owner/admin/receptionist ven todas las citas del tenant
      EXISTS (
        SELECT 1 FROM staff
        WHERE staff.tenant_id = appointments.tenant_id
          AND staff.user_id = auth.uid()
          AND staff.role IN ('owner', 'admin', 'receptionist')
      )
      -- O el doctor cuyas citas son
      OR appointments.staff_id IN (
        SELECT id FROM staff
        WHERE tenant_id = appointments.tenant_id AND user_id = auth.uid()
      )
    )
  )
  WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr después del apply):
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Backfill OK:
--      SELECT name, role, user_id IS NOT NULL AS linked, plan, is_billable
--      FROM staff WHERE tenant_id = '<tu_tenant>';
--    Debe haber al menos 1 staff con role='owner' y linked=true.
--
-- 2. Helper funciona (logueado como owner):
--      SELECT * FROM get_user_staff();
--
-- 3. Invitations table existe:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'staff_invitations';
