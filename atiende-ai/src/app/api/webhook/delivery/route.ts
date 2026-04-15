import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook, enforceWebhookSize, enforceWebhookSizePostRead, WEBHOOK_MAX_BYTES } from '@/lib/webhook-logger';
import { parseRappiOrder, parseUberEatsOrder, parseDidiOrder } from '@/lib/integrations/delivery';

type DeliveryProvider = 'rappi' | 'uber_eats' | 'didi_food';

function identifyProvider(req: NextRequest): DeliveryProvider | null {
  if (req.headers.get('x-rappi-signature')) return 'rappi';
  if (req.headers.get('x-uber-signature')) return 'uber_eats';
  if (req.headers.get('x-didi-token')) return 'didi_food';
  return null;
}

function verifyProviderAuth(req: NextRequest, provider: DeliveryProvider): boolean {
  switch (provider) {
    case 'rappi': {
      const sig = req.headers.get('x-rappi-signature');
      return sig === process.env.RAPPI_WEBHOOK_SECRET;
    }
    case 'uber_eats': {
      const sig = req.headers.get('x-uber-signature');
      return sig === process.env.UBER_EATS_WEBHOOK_SECRET;
    }
    case 'didi_food': {
      const token = req.headers.get('x-didi-token');
      return token === process.env.DIDI_WEBHOOK_TOKEN;
    }
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    // AUDIT R17 BUG-002: guard de tamaño ANTES de bufferear.
    const sizeCheck = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'delivery', startTime);
    if (!sizeCheck.ok) return sizeCheck.response;

    const provider = identifyProvider(req);
    if (!provider) {
      logWebhook({ provider: 'delivery', eventType: 'unknown_provider', statusCode: 400, error: 'Could not identify delivery provider', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Unknown delivery provider' }, { status: 400 });
    }

    if (!verifyProviderAuth(req, provider)) {
      logWebhook({ provider: 'delivery', eventType: 'auth_failed', statusCode: 401, error: `Invalid ${provider} auth`, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawText = await req.text();
    const postRead = enforceWebhookSizePostRead(Buffer.byteLength(rawText, 'utf8'), WEBHOOK_MAX_BYTES, 'delivery', startTime);
    if (!postRead.ok) return postRead.response;

    const payload = JSON.parse(rawText);

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
