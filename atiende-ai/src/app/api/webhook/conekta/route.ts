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
  // timingSafeEqual throws RangeError if the two Buffers differ in length.
  // A malicious `digest` header of arbitrary length would surface as a 500
  // response (via the outer try/catch) instead of the correct 401.
  try {
    const expected = Buffer.from(expectedDigest, 'hex');
    const received = Buffer.from(signatureHeader, 'hex');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
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
        // AUDIT-R9 CRÍT: incluir voice_minutes_included al upgrade.
        // Antes los tenants premium via OXXO/SPEI quedaban con
        // voice_minutes_included=0 y todo el uso era overage retroactivo.
        // NOTA: Conekta es one-time-pay (no subscription), así que NO podemos
        // poblar stripe_subscription_item_voice_id. El cron de overage
        // skip-eará a estos tenants — el cobro de excedentes vía OXXO
        // requiere un flujo aparte (ej. crear nuevo order al final del mes).
        const voicePatch = plan === 'premium'
          ? { voice_minutes_included: 300 }
          : { voice_minutes_included: 0 };
        const { error } = await supabaseAdmin
          .from('tenants')
          .update({ plan, ...voicePatch, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
        if (error) {
          console.error('[conekta-webhook] Failed to update tenant plan:', error.message);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
        console.warn(`[conekta-webhook] Tenant ${tenantId} upgraded to ${plan}` + (plan === 'premium' ? ' (300 min voz incluidos; overage NO se cobra automático via Conekta)' : ''));
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
          console.warn(`[conekta-webhook] Order expired for tenant ${tenantId}`);
        }
        break;
      }

      default:
        console.warn(`[conekta-webhook] Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[conekta-webhook] Unexpected error:', message);
    logWebhook({ provider: 'conekta', eventType: 'error', statusCode: 500, error: message, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
