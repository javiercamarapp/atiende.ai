import { createServerSupabase } from '@/lib/supabase/server'

export async function getAuthenticatedTenant() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, tenantId: null }

  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  return { supabase, user, tenantId: userRow?.tenant_id ?? null }
}
