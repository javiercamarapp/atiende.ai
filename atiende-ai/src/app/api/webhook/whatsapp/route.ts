import { NextRequest, NextResponse } from 'next/server';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook } from '@/lib/webhook-logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

// GET: Verificacion del webhook (Meta lo llama UNA VEZ al configurar)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// POST: Recibir mensajes — el endpoint mas importante del sistema
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    // WA_APP_SECRET is REQUIRED — never skip signature verification.
    const appSecret = process.env.WA_APP_SECRET;
    if (!appSecret) {
      logger.error('WA_APP_SECRET missing — refusing to process webhook');
      logWebhook({ provider: 'whatsapp', eventType: 'config_error', statusCode: 500, error: 'WA_APP_SECRET not configured', durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'WA_APP_SECRET not configured' }, { status: 500 });
    }

    // Verify Meta/WhatsApp signature using WA_APP_SECRET
    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();

    if (!signature) {
      console.error('Missing x-hub-signature-256 header');
      logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Missing signature header', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      console.error('Invalid webhook signature');
      logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Invalid signature', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Extract event type from WhatsApp payload
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const waPhoneId = changes?.value?.metadata?.phone_number_id;
    const hasMessages = changes?.value?.messages?.length > 0;
    const hasStatuses = changes?.value?.statuses?.length > 0;
    const eventType = hasMessages ? 'message' : hasStatuses ? 'status' : 'unknown';

    logWebhook({
      provider: 'whatsapp',
      eventType,
      statusCode: 200,
      payload: { phone_number_id: waPhoneId, field: changes?.field },
      durationMs: Date.now() - startTime,
    });

    // Handle delivery status updates (sent, delivered, read)
    if (changes?.value?.statuses) {
      for (const status of changes.value.statuses) {
        // Look up tenant_id FIRST so we can scope the update and prevent
        // cross-tenant ID collisions from corrupting another tenant's data.
        (async () => {
          try {
            const { data: msg, error: lookupErr } = await supabaseAdmin
              .from('messages')
              .select('tenant_id')
              .eq('wa_message_id', status.id)
              .maybeSingle();
            if (lookupErr || !msg?.tenant_id) {
              logger.error('Failed to resolve tenant for status update', lookupErr instanceof Error ? lookupErr : undefined, { wa_message_id: status.id });
              return;
            }
            const { error: updateErr } = await supabaseAdmin
              .from('messages')
              .update({
                wa_status: status.status, // sent, delivered, read
                status_updated_at: new Date(parseInt(status.timestamp) * 1000).toISOString(),
              })
              .eq('wa_message_id', status.id)
              .eq('tenant_id', msg.tenant_id);
            if (updateErr) {
              console.error('Failed to update message status:', updateErr);
            }
          } catch (err) {
            console.error('Failed to update message status:', err);
          }
        })();
      }
    }

    // RESPONDER 200 INMEDIATAMENTE — no bloquear
    // Procesar el mensaje en background
    processIncomingMessage(body).catch(err => {
      console.error('Error procesando mensaje WA:', err);
      logWebhook({ provider: 'whatsapp', eventType: 'process_error', error: err instanceof Error ? err.message : 'Unknown error' });
    });

    return NextResponse.json({ status: 'received' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    logWebhook({ provider: 'whatsapp', eventType: 'error', statusCode: 500, error: error instanceof Error ? error.message : 'Unknown error', durationMs: Date.now() - startTime });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
