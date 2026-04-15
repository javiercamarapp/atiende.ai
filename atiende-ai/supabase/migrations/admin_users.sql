-- ════════════════════════════════════════════════════════════════════════════
-- ADMIN USERS — RBAC dinámico (FIX 11)
--
-- Reemplaza la allowlist hardcodeada en src/app/(admin)/layout.tsx por una
-- tabla. Onboardear un nuevo admin no requiere deploy.
--
-- Acceso: solo service_role lee/escribe (frontend usa supabaseAdmin desde
-- el server component layout). Sin RLS para anon/authenticated.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_users (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  role         TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'support', 'readonly')),
  granted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- No policies para anon/authenticated → solo service_role puede leer/escribir.
-- (Esto fuerza que toda lectura admin pase por supabaseAdmin desde server-side.)

COMMENT ON TABLE admin_users IS
  'RBAC para panel /admin. Reemplaza el ADMIN_EMAILS hardcoded.';

-- Seed inicial: si el usuario ya existe en auth.users con rol admin en
-- app_metadata, lo migramos. Idempotente.
INSERT INTO admin_users (user_id, email, role, notes)
SELECT u.id, u.email, 'admin', 'Migrated from app_metadata.role'
FROM auth.users u
WHERE (u.raw_app_meta_data->>'role')::text = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- Bootstrap: garantiza que javier@atiende.ai sigue siendo admin si existe.
INSERT INTO admin_users (user_id, email, role, notes)
SELECT u.id, u.email, 'admin', 'Bootstrap (atiende founder)'
FROM auth.users u
WHERE u.email IN ('javier@atiende.ai', 'admin@atiende.ai')
ON CONFLICT (user_id) DO NOTHING;
