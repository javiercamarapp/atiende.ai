// ─────────────────────────────────────────────────────────────────────────────
// Helper RBAC — verifica si el usuario autenticado es admin.
//
// Replaced: `ADMIN_EMAILS` hardcoded arrays en cada ruta admin. Ahora todas
// las rutas consultan `admin_users` table + `app_metadata.role='admin'`.
// ─────────────────────────────────────────────────────────────────────────────

import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function isAdminUser(user: User | null | undefined): Promise<boolean> {
  if (!user) return false;
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  if (role === 'admin') return true;

  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}
