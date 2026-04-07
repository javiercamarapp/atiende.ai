import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';
import { logger } from '@/lib/logger';
import { parseRappiOrder, parseUberEatsOrder, parseDidiOrder } from '@/lib/integrations/delivery';
import crypto from 'crypto';

type DeliveryProvider = 'rappi' | 'uber_eats' | 'didi_food';

function identifyProvider(req: NextRequest): DeliveryProvider | null {
  if (req.headers.get('x-rappi-signature')) return 'rappi';
  if (req.headers.get('x-uber-signature')) return 'uber_eats';
  if (req.headers.get('x-didi-token')) return 'didi_food';
  return null;
}

// HMAC-SHA256 signature verification with constant-time comparison.
// Each provider sends its signature in a provider-specific header; we
// verify against the raw request body using the corresponding secret.
function verifyHmacSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  // Strip optional "sha256=" prefix some providers use.
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  // Length mismatch must be handled BEFORE timingSafeEqual (which throws).
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function verifyProviderAuth(req: NextRequest, provider: DeliveryProvider, rawBody: string): boolean {
  switch (provider) {
    case 'rappi': {
      const sig =
        req.headers.get('x-rappi-signature') ??
        req.headers.get('x-signature') ??
        req.headers.get('x-hub-signature-256');
      return verifyHmacSignature(rawBody, sig, process.env.RAPPI_WEBHOOK_SECRET);
    }
    case 'uber_eats': {
      const sig =
        req.headers.get('x-uber-signature') ??
        req.headers.get('x-signature') ??
        req.headers.get('x-hub-signature-256');
      return verifyHmacSignature(rawBody, sig, process.env.UBEREATS_WEBHOOK_SECRET);
    }
    case 'didi_food': {
      const sig =
        req.headers.get('x-didi-signature') ??
        req.headers.get('x-didi-token') ??
        req.headers.get('x-signature') ??
        req.headers.get('x-hub-signature-256');
      return verifyHmacSignature(rawBody, sig, process.env.DIDI_WEBHOOK_SECRET);
    }
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const provider = identifyProvider(req);
    if (!provider) {
      logWebhook({ provider: 'delivery', eventType: 'unknown_provider', statusCode: 400, error: 'Could not identify delivery provider', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Unknown delivery provider' }, { status: 400 });
    }

    // Read raw body so we can HMAC-verify it before parsing.
    const rawBody = await req.text();

    if (!verifyProviderAuth(req, provider, rawBody)) {
      logWebhook({ provider: 'delivery', eventType: 'auth_failed', statusCode: 401, error: `Invalid ${provider} signature`, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let order: ReturnType<typeof parseRappiOrder> | ReturnType<typeof parseUberEatsOrder> | ReturnType<typeof parseDidiOrder>;
    switch (provider) {
      case 'rappi':
        order = parseRappiOrder(payload);
        break;
      case 'uber_eats':
        order = parseUberEatsOrder(payload);
        break;
      case 'didi_food':
        order = parseDidiOrder(payload);
        break;
    }

    // Look up the tenant by their delivery platform config
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('delivery_platform', provider)
      .single();

    if (!tenant) {
      logWebhook({ provider: 'delivery', eventType: `${provider}_order`, statusCode: 404, error: 'No tenant found for provider', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Insert order into the database
    const { error: insertError } = await supabaseAdmin.from('orders').insert({
      tenant_id: tenant.id,
      platform: order.platform,
      external_order_id: order.orderId,
      customer_name: order.customerName,
      items: order.items,
      total: order.total,
      status: 'pending',
      order_type: 'delivery',
    });

    if (insertError) {
      console.error('[delivery-webhook] Failed to insert order:', insertError.message);
      logWebhook({ provider: 'delivery', eventType: `${provider}_order`, tenantId: tenant.id, statusCode: 500, error: insertError.message, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Failed to save order' }, { status: 500 });
    }

    logWebhook({
      tenantId: tenant.id,
      provider: 'delivery',
      eventType: `${provider}_order`,
      statusCode: 200,
      payload: { orderId: order.orderId, platform: order.platform, total: order.total },
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ received: true, platform: order.platform, orderId: order.orderId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[delivery-webhook] Unexpected error:', message);
    logWebhook({ provider: 'delivery', eventType: 'error', statusCode: 500, error: message, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
