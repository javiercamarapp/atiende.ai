import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook, enforceWebhookSize, enforceWebhookSizePostRead, WEBHOOK_MAX_BYTES } from '@/lib/webhook-logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishMessage, isQStashConfigured } from '@/lib/queue/qstash';
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

    // AUDIT R17 BUG-002: guard de tamaño ANTES de bufferear. Rechaza payloads
    // >2MB (Meta payloads típicamente <10KB) para evitar OOM en el worker
    // antes de llegar a la validación HMAC.
    const sizeCheck = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'whatsapp', startTime);
    if (!sizeCheck.ok) return sizeCheck.response;

    // AUDIT-R8 CRÍT: req.text() puede re-codificar UTF-8 (emojis compuestos,
    // acentos español) cambiando los bytes originales — el HMAC fallaría
    // intermitentemente con mensajes que tengan ñ, á, é, emojis compuestos.
    // Usamos arrayBuffer() para preservar bytes EXACTOS que firmó Meta.
    const rawBuffer = Buffer.from(await req.arrayBuffer());

    // Post-read sanity: content-length puede faltar/mentir.
    const postRead = enforceWebhookSizePostRead(rawBuffer.byteLength, WEBHOOK_MAX_BYTES, 'whatsapp', startTime);
    if (!postRead.ok) return postRead.response;

    if (!signature) {
      console.error('Missing x-hub-signature-256 header');
      logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Missing signature header', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', process.env.WA_APP_SECRET)
      .update(rawBuffer)
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

    // Decodificamos el buffer a string UTF-8 para parseo JSON. Notar que
    // este toString es POSTERIOR a la verificación HMAC, así que cualquier
    // re-codificación interna no afecta la integridad criptográfica.
    const body = JSON.parse(rawBuffer.toString('utf8'));

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

    // FIX 1 (audit R4): idempotency check SÍNCRONO antes de disparar el
    // background task. Si Meta nos reintenta un mensaje (p.ej. por timeout
    // en nuestra respuesta de 5s previa) ya grabado, retornamos 200 sin
    // costar LLM ni WhatsApp API en el reintento. Solo ~20ms de latencia.
    try {
      const firstMessageId = changes?.value?.messages?.[0]?.id as string | undefined;
      if (firstMessageId) {
        const { data: existing } = await supabaseAdmin
          .from('messages')
          .select('id')
          .eq('wa_message_id', firstMessageId)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ status: 'duplicate_ignored' });
        }
      }
    } catch {
      /* Best effort — si el check falla, dejamos que el pipeline idempotente
         interno del processor maneje el duplicado. */
    }

    // Patrón "Fast Response + async queue": respondemos 200 inmediatamente
    // y movemos el procesamiento al worker vía QStash. Si QStash no está
    // configurado (dev/local), fallback a waitUntil.
    //
    // Ventajas de QStash vs waitUntil:
    //   - Si el worker falla, QStash reintenta con backoff (hasta 3x)
    //   - Si Vercel mata la función a los 5min, QStash la reencola
    //   - Decouple total: webhook responde a Meta sin depender del LLM
    //   - Observabilidad: dashboard de QStash muestra errores/retries
    if (isQStashConfigured()) {
      // AUDIT-R8 ALTO: misma URL base que el worker usa para verificar firma.
      // Si difieren, QStash firma con base A pero el worker valida contra base B.
      // AUDIT R12 BUG-002: triple fallback. WORKER_URL_BASE > NEXT_PUBLIC_APP_URL
      // > req.nextUrl.origin. En Vercel preview/edge, nextUrl.origin puede ser
      // interno (localhost, *.vercel.app sin custom domain) y QStash firmaría
      // con una URL que el worker valida con origen diferente → 401.
      const baseUrl = process.env.WORKER_URL_BASE
        || process.env.NEXT_PUBLIC_APP_URL
        || req.nextUrl.origin;
      const workerUrl = `${baseUrl}/api/worker/process-message`;
      const pub = await publishMessage(workerUrl, body);
      if (!pub.ok) {
        // Publicación falló — fallback a waitUntil para no perder el mensaje.
        console.warn('[webhook] QStash publish failed, fallback to waitUntil:', pub.reason);
        waitUntil(
          processIncomingMessage(body).catch((err) => {
            console.error('Error procesando mensaje WA (fallback):', err);
            logWebhook({ provider: 'whatsapp', eventType: 'process_error', error: err instanceof Error ? err.message : 'Unknown error' });
          }),
        );
      }
    } else {
      // Sin QStash configurado — modo legacy con waitUntil.
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
    }

    return NextResponse.json({ status: 'processing' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    logWebhook({ provider: 'whatsapp', eventType: 'error', statusCode: 500, error: error instanceof Error ? error.message : 'Unknown error', durationMs: Date.now() - startTime });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
