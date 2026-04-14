import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;
  let event;

  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    logWebhook({ provider: 'stripe', eventType: 'auth_failed', statusCode: 400, error: 'Invalid signature', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Invalid sig' }, { status: 400 });
  }

  const obj = event.data.object as unknown as Record<string, unknown>;
  const tenantId = obj?.metadata
    ? (obj.metadata as Record<string, string>)?.tenant_id
    : undefined;

  logWebhook({
    tenantId,
    provider: 'stripe',
    eventType: event.type,
    statusCode: 200,
    payload: { event_id: event.id, type: event.type },
    durationMs: Date.now() - startTime,
  });

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as unknown as Record<string, unknown>;
    const meta = s.metadata as Record<string, string> | undefined;
    const tid = meta?.tenant_id;
    const plan = meta?.plan;
    const stripeCustomer = s.customer as string | undefined;

    if (tid && plan && stripeCustomer) {
      // Defense-in-depth: if this tenant already has a stripe_customer_id
      // on file, make sure the new event comes from the same customer.
      // The signed webhook guarantees Stripe-provided authenticity, but
      // this guards against metadata-replay across accounts.
      const { data: existing } = await supabaseAdmin
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tid)
        .single();
      if (existing?.stripe_customer_id && existing.stripe_customer_id !== stripeCustomer) {
        console.warn(
          `[stripe-webhook] customer mismatch for tenant ${tid}: existing=${existing.stripe_customer_id}, event=${stripeCustomer}`,
        );
        return NextResponse.json({ received: true });
      }
      await supabaseAdmin
        .from('tenants')
        .update({ plan, stripe_customer_id: stripeCustomer })
        .eq('id', tid);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as unknown as Record<string, unknown>;
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('stripe_customer_id', sub.customer as string).single();
    if (t) await supabaseAdmin.from('tenants').update({ plan: 'free_trial', status: 'paused' }).eq('id', t.id);
  }

  return NextResponse.json({ received: true });
}
