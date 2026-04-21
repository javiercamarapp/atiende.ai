import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json({ count: 0 });
  }

  // Ventana = mes calendario en curso (UTC). El billing de Stripe usa su
  // propio ciclo (anchor date al checkout), así que esta métrica es orientativa
  // — sirve para el indicador de uso en UI, no para facturar.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { count, error } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('direction', 'inbound')
    .gte('created_at', monthStart);

  if (error) {
    console.error('[api/billing/usage]', error.message);
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
