import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { createPortalSession } from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await checkApiRateLimit(`${user.id}:billing_portal`, 10, 60)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, stripe_customer_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenant || !tenant.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No hay suscripción activa. Contrata un plan primero.' },
      { status: 404 },
    );
  }

  try {
    const session = await createPortalSession(tenant.stripe_customer_id as string);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'portal_failed';
    console.error('[api/billing/portal]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
