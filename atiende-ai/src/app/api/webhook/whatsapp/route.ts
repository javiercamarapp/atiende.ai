import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook, enforceWebhookSize, enforceWebhookSizePostRead, WEBHOOK_MAX_BYTES } from '@/lib/webhook-logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishMessage, isQStashConfigured } from '@/lib/queue/qstash';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import {
  WhatsAppWebhookSchema,
  checkWebhookReplay,
  extractMessageIds,
} from '@/lib/whatsapp/webhook-schema';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

// AUDIT P1 item 3: rechazar payloads cuyos mensajes tengan >5 min de edad.
// Meta normalmente entrega en <5s; >5 min indica replay (captura previa
// reenviada por un atacante con el secret) o un reintento ya irrelevante.
const WEBHOOK_REPLAY_MAX_AGE_SECONDS = 300;

// AUDIT P1 item 4: rate limit por IP de origen. Meta usa un pool acotado de
// IPs; 300/min es generoso (tráfico real típico <50/min por IP). Se aplica
// después del HMAC para que un atacante sin el secret gaste primero el HMAC
// check (cheap) y el rate-limit segundo.
const WEBHOOK_IP_RATE_LIMIT = 300;
const WEBHOOK_IP_RATE_WINDOW = 60;

function extractClientIp(req: NextRequest): string {
  // Vercel sets x-real-ip from the TCP connection — cannot be spoofed.
  // x-forwarded-for CAN be spoofed by the client prepending fake IPs.
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  // Fallback: last entry in x-forwarded-for is the one added by the edge
  // proxy (rightmost = most trusted), not the first (client-controlled).
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',');
    return parts[parts.length - 1].trim();
  }
  return 'unknown';
}

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

// GET: Verificacion del webhook (Meta lo llama UNA VEZ al configurar).
// Usamos timingSafeEqual para que un atacante no pueda fingerprintear el
// verify token comparando tiempos de respuesta caracter por caracter.
// Si longitudes difieren, rechazamos sin comparar (igual que HMAC en POST).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  const expected = process.env.WA_VERIFY_TOKEN ?? '';

  if (mode !== 'subscribe' || !expected) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  const equal =
    tokenBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(tokenBuf, expectedBuf);

  if (equal) {
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
      logger.error('[whatsapp-webhook] WA_APP_SECRET not configured — rejecting all webhooks', undefined, {  });
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
      logger.error('[whatsapp-webhook] missing x-hub-signature-256 header', undefined, {  });
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
      logger.error('[whatsapp-webhook] invalid HMAC signature', undefined, {  });
      logWebhook({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401, error: 'Invalid signature', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // AUDIT P1 item 4: rate-limit por IP POST-HMAC. Un atacante sin el
    // secret ya fue rechazado arriba; este gate protege contra payload floods
    // desde IPs legítimas (o un secret leaked). Fail-open si Redis no responde.
    const clientIp = extractClientIp(req);
    const rateLimited = await checkApiRateLimit(
      `wa_webhook:${clientIp}`,
      WEBHOOK_IP_RATE_LIMIT,
      WEBHOOK_IP_RATE_WINDOW,
    );
    if (rateLimited) {
      logWebhook({
        provider: 'whatsapp',
        eventType: 'rate_limited',
        statusCode: 429,
        payload: { ip: clientIp },
        durationMs: Date.now() - startTime,
      });
      // Devolvemos 200 (no 429) para que Meta NO reintente — el duplicado
      // sería peor que perder un mensaje en un burst real.
      return NextResponse.json({ status: 'rate_limited' });
    }

    // AUDIT P1 item 2: JSON.parse seguro. Si el body está corrupto devolver
    // 500 haría que Meta reintente hasta 3x, duplicando procesamiento cuando
    // eventualmente una retry sí parse correctamente. Respondemos 200 con
    // status='invalid_json' para que Meta deje de reintentar.
    let body: unknown;
    try {
      body = JSON.parse(rawBuffer.toString('utf8'));
    } catch (err) {
      logger.warn('[whatsapp-webhook] malformed JSON payload', {  err: err instanceof Error ? err.message : err  });
      logWebhook({
        provider: 'whatsapp',
        eventType: 'invalid_json',
        statusCode: 200,
        error: err instanceof Error ? err.message : 'JSON parse error',
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ status: 'invalid_json' });
    }

    // AUDIT P2 item 6: validar schema del payload con Zod. `.passthrough()` en
    // todos los objetos preserva campos desconocidos (Meta cambia la API
    // constantemente); solo imponemos validación estricta en los campos que
    // el pipeline usa y que si son garbage causan crashes downstream.
    const parseResult = WhatsAppWebhookSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('[whatsapp-webhook] payload failed schema validation', {  issues: parseResult.error.issues.slice(0, 3)  });
      logWebhook({
        provider: 'whatsapp',
        eventType: 'invalid_payload',
        statusCode: 200,
        error: `schema: ${parseResult.error.issues[0]?.message || 'unknown'}`,
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ status: 'invalid_payload' });
    }
    const validated = parseResult.data;

    // Extract event type from WhatsApp payload (usando datos validados).
    const entry = validated.entry[0];
    const changes = entry.changes[0];
    const waPhoneId = changes.value.metadata.phone_number_id;
    const hasMessages = (changes.value.messages?.length || 0) > 0;
    const hasStatuses = (changes.value.statuses?.length || 0) > 0;
    const eventType = hasMessages ? 'message' : hasStatuses ? 'status' : 'unknown';

    logWebhook({
      provider: 'whatsapp',
      eventType,
      statusCode: 200,
      payload: { phone_number_id: waPhoneId, field: changes.field },
      durationMs: Date.now() - startTime,
    });

    // Handle delivery status updates (sent, delivered, read)
    if (changes.value.statuses) {
      for (const status of changes.value.statuses) {
        supabaseAdmin
          .from('messages')
          .update({
            wa_status: status.status, // sent, delivered, read
            status_updated_at: new Date(parseInt(status.timestamp) * 1000).toISOString(),
          })
          .eq('wa_message_id', status.id)
          .then(() => {}, (err: unknown) => {
            logger.error('[whatsapp-webhook] failed to update message status', undefined, {  err: err instanceof Error ? err.message : err, waMessageId: status.id  });
          });
      }
    }

    // AUDIT P1 item 3: replay protection. Si el payload trae mensajes con
    // timestamp > 5 min de edad es replay o retry ya irrelevante. Respondemos
    // 200 para no triggear reintento de Meta.
    if (hasMessages) {
      const replay = checkWebhookReplay(validated, WEBHOOK_REPLAY_MAX_AGE_SECONDS);
      if (!replay.ok) {
        logger.warn('[whatsapp-webhook] replay rejected', {  ageSeconds: replay.ageSeconds, maxAge: WEBHOOK_REPLAY_MAX_AGE_SECONDS  });
        logWebhook({
          provider: 'whatsapp',
          eventType: 'replay_rejected',
          statusCode: 200,
          error: `age=${replay.ageSeconds}s`,
          durationMs: Date.now() - startTime,
        });
        return NextResponse.json({ status: 'replay_rejected' });
      }
    }

    // AUDIT P1 item 1: idempotency MULTI-MESSAGE. Antes solo verificábamos
    // `messages[0].id` — un batch de N mensajes (raro pero Meta lo hace en
    // reintentos) procesaba N-1 duplicados. Ahora query batch con .in().
    // Si TODOS los IDs están en DB, es duplicado completo → short-circuit
    // sin disparar worker. Si solo algunos, dejamos que el processor filtre
    // (su propio check por-mensaje ya es idempotente vía UNIQUE constraint).
    try {
      const allMessageIds = extractMessageIds(validated);
      if (allMessageIds.length > 0) {
        const { data: existingRows } = await supabaseAdmin
          .from('messages')
          .select('wa_message_id')
          .in('wa_message_id', allMessageIds);
        const existingIds = new Set((existingRows || []).map((r) => r.wa_message_id));
        if (existingIds.size === allMessageIds.length) {
          logWebhook({
            provider: 'whatsapp',
            eventType: 'duplicate_batch',
            statusCode: 200,
            payload: { count: allMessageIds.length },
            durationMs: Date.now() - startTime,
          });
          return NextResponse.json({ status: 'duplicate_ignored' });
        }
      }
    } catch {
      /* Best effort — si el check falla, dejamos que el pipeline idempotente
         interno del processor maneje el duplicado vía UNIQUE constraint. */
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
      const pub = await publishMessage(workerUrl, validated);
      if (!pub.ok) {
        // Publicación falló — fallback a waitUntil para no perder el mensaje.
        logger.warn('[whatsapp-webhook] QStash publish failed, fallback to waitUntil', {  reason: pub.reason  });
        waitUntil(
          processIncomingMessage(validated as never).catch((err) => {
            logger.error('[whatsapp-webhook] process error (fallback)', undefined, {  err: err instanceof Error ? err.message : err  });
            logWebhook({ provider: 'whatsapp', eventType: 'process_error', error: err instanceof Error ? err.message : 'Unknown error' });
          }),
        );
      }
    } else {
      // Sin QStash configurado — modo legacy con waitUntil.
      waitUntil(
        processIncomingMessage(validated as never).catch((err) => {
          logger.error('[whatsapp-webhook] process error', undefined, {  err: err instanceof Error ? err.message : err  });
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
    logger.error('[whatsapp-webhook] uncaught error', undefined, {  err: error instanceof Error ? error.message : error  });
    logWebhook({ provider: 'whatsapp', eventType: 'error', statusCode: 500, error: error instanceof Error ? error.message : 'Unknown error', durationMs: Date.now() - startTime });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
