import { NextRequest, NextResponse } from 'next/server';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook } from '@/lib/webhook-logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
    // Verify Meta/WhatsApp signature using WA_APP_SECRET
    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();

    if (process.env.WA_APP_SECRET) {
      if (!signature) {
        console.error('Missing x-hub-signature-256 header');
        logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Missing signature header', durationMs: Date.now() - startTime });
        return new NextResponse('Unauthorized', { status: 401 });
      }

      const expectedSig = 'sha256=' + crypto
        .createHmac('sha256', process.env.WA_APP_SECRET)
        .update(rawBody)
        .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig)
      )) {
        console.error('Invalid webhook signature');
        logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Invalid signature', durationMs: Date.now() - startTime });
        return new NextResponse('Unauthorized', { status: 401 });
      }
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
        supabaseAdmin
          .from('messages')
          .update({
            wa_status: status.status, // sent, delivered, read
            status_updated_at: new Date(parseInt(status.timestamp) * 1000).toISOString(),
          })
          .eq('wa_message_id', status.id)
          .then(() => {}, (err: unknown) => {
            console.error('Failed to update message status:', err);
          });
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
