import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook } from '@/lib/webhook-logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag — Tool calling pipeline (Fase 1 de la migración)
//
// Cuando `USE_TOOL_CALLING=true` en el entorno, el `processor.ts` decide caso
// por caso si usar el nuevo orquestador (basado en
// `tenants.features.tool_calling`). Cuando `false`, el sistema se comporta
// IDÉNTICO al pipeline tradicional (classifier + dispatch + handlers).
//
// Mantén `USE_TOOL_CALLING=false` en producción hasta validar el nuevo
// pipeline en staging. El processor lee la misma env var por su cuenta —
// no importamos esta constante para no acoplar lib/* a un route file.
// ─────────────────────────────────────────────────────────────────────────────
const USE_TOOL_CALLING = process.env.USE_TOOL_CALLING === 'true';
void USE_TOOL_CALLING; // referenced for documentation; processor reads env directly

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
    // Verify Meta/WhatsApp signature using WA_APP_SECRET — MANDATORY.
    // If the env var is not configured, reject ALL webhooks with 500 so a
    // misconfigured deployment can't be used as an unauthenticated entry
    // point to the message processor.
    if (!process.env.WA_APP_SECRET) {
      console.error('[whatsapp-webhook] WA_APP_SECRET not configured — rejecting all webhooks');
      logWebhook({
        provider: 'whatsapp',
        eventType: 'config_error',
        statusCode: 500,
        error: 'WA_APP_SECRET not configured',
        durationMs: Date.now() - startTime,
      });
      return new NextResponse('Server misconfiguration', { status: 500 });
    }

    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();

    if (!signature) {
      console.error('Missing x-hub-signature-256 header');
      logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Missing signature header', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', process.env.WA_APP_SECRET)
      .update(rawBody)
      .digest('hex');

    // Length mismatch = guaranteed invalid; timingSafeEqual throws otherwise.
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    let valid = false;
    if (sigBuf.length === expectedBuf.length) {
      try {
        valid = crypto.timingSafeEqual(sigBuf, expectedBuf);
      } catch {
        valid = false;
      }
    }
    if (!valid) {
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

    // RESPONDER 200 INMEDIATAMENTE — no bloquear.
    // CRÍTICO: usar waitUntil de @vercel/functions para que la función
    // serverless NO se congele al retornar — sin esto, processIncomingMessage
    // puede truncarse a medio LLM call, dejando mensajes sin procesar.
    waitUntil(
      processIncomingMessage(body).catch((err) => {
        console.error('Error procesando mensaje WA:', err);
        logWebhook({
          provider: 'whatsapp',
          eventType: 'process_error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }),
    );

    return NextResponse.json({ status: 'received' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    logWebhook({ provider: 'whatsapp', eventType: 'error', statusCode: 500, error: error instanceof Error ? error.message : 'Unknown error', durationMs: Date.now() - startTime });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
