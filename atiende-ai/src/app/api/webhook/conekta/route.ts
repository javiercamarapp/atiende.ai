import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';
import crypto from 'crypto';

function verifyConektaSignature(
  payload: string,
  signatureHeader: string | null,
  webhookKey: string
): boolean {
  if (!signatureHeader) return false;
  const expectedDigest = crypto
    .createHmac('sha256', webhookKey)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expectedDigest, 'hex'),
    Buffer.from(signatureHeader, 'hex')
  );
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('digest') ?? req.headers.get('http_digest');
    const webhookKey = process.env.CONEKTA_WEBHOOK_KEY;

    if (!webhookKey) {
      console.error('[conekta-webhook] CONEKTA_WEBHOOK_KEY not configured');
      logWebhook({ provider: 'conekta', eventType: 'config_error', statusCode: 500, error: 'CONEKTA_WEBHOOK_KEY not configured', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const isValid = verifyConektaSignature(rawBody, signature, webhookKey);
    if (!isValid) {
      console.warn('[conekta-webhook] Invalid signature');
      logWebhook({ provider: 'conekta', eventType: 'auth_failed', statusCode: 401, error: 'Invalid signature', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const eventType: string = body.type ?? '';
    const data = body.data?.object;
    const tenantId = data?.metadata?.tenant_id;

    logWebhook({
      tenantId,
      provider: 'conekta',
      eventType,
      statusCode: 200,
      payload: { order_id: data?.id, type: eventType },
      durationMs: Date.now() - startTime,
    });

    switch (eventType) {
      case 'order.paid': {
        const plan = data?.metadata?.plan;
        if (!tenantId || !plan) {
          console.warn('[conekta-webhook] order.paid missing tenant_id or plan in metadata');
          break;
        }
        const { error } = await supabaseAdmin
          .from('tenants')
          .update({ plan, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
        if (error) {
          console.error('[conekta-webhook] Failed to update tenant plan:', error.message);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
        console.log(`[conekta-webhook] Tenant ${tenantId} upgraded to ${plan}`);
        break;
      }

      case 'order.expired': {
        if (tenantId) {
          // Log the expiration event for follow-up notifications
          await supabaseAdmin.from('audit_log').insert({
            tenant_id: tenantId,
            action: 'order.expired',
            entity_type: 'payment',
            details: {
              conekta_order_id: data?.id,
              amount: data?.amount,
              currency: data?.currency,
            },
          });
          console.log(`[conekta-webhook] Order expired for tenant ${tenantId}`);
        }
        break;
      }

      default:
        console.log(`[conekta-webhook] Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[conekta-webhook] Unexpected error:', message);
    logWebhook({ provider: 'conekta', eventType: 'error', statusCode: 500, error: message, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
