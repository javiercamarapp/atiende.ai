import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
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
    if (tid && plan) await supabaseAdmin.from('tenants').update({ plan, stripe_customer_id: s.customer as string }).eq('id', tid);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as unknown as Record<string, unknown>;
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('stripe_customer_id', sub.customer as string).single();
    if (t) await supabaseAdmin.from('tenants').update({ plan: 'free_trial', status: 'paused' }).eq('id', t.id);
  }

  return NextResponse.json({ received: true });
}
