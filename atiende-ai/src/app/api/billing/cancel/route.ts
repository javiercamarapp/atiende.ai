import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { getStripe } from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await checkApiRateLimit(`${user.id}:billing_cancel`, 5, 60)) {
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
      { error: 'No hay suscripción activa.' },
      { status: 404 },
    );
  }

  try {
    // Listar subs activas del customer y programar cancel al fin del periodo.
    // No cancelamos inmediato — el usuario conserva acceso hasta el siguiente
    // billing date. La transición a plan='free_trial' ocurre cuando Stripe
    // dispara `customer.subscription.deleted` al expirar.
    const subs = await getStripe().subscriptions.list({
      customer: tenant.stripe_customer_id as string,
      status: 'active',
      limit: 5,
    });

    if (subs.data.length === 0) {
      return NextResponse.json(
        { error: 'No hay suscripciones activas en Stripe.' },
        { status: 404 },
      );
    }

    for (const sub of subs.data) {
      await getStripe().subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });
    }

    return NextResponse.json({
      ok: true,
      cancelled_count: subs.data.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'cancel_failed';
    console.error('[api/billing/cancel]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
