import { supabaseAdmin } from '@/lib/supabase/admin';

/** Patterns that match PII in webhook payloads */
const PII_KEYS = ['phone', 'phone_number', 'wa_id', 'from', 'to', 'body', 'text', 'message', 'display_phone_number'];
/** IDs externos (event_id, call_id, appointment_id) que NO son PII pero
 *  identifican unívocamente la transacción. Si los logs leak, un atacante
 *  podría correlacionar/replicar eventos. Los enmascaramos a `…last4`. */
const ID_KEYS = ['event_id', 'eventid', 'call_id', 'callid', 'appointment_id', 'session_id', 'sub_id', 'subscription_id', 'invoice_id'];

function maskIdValue(value: string): string {
  if (value.length <= 4) return '***';
  return `…${value.slice(-4)}`;
}

/**
 * Recursively redact PII fields from a payload object. PII values become
 * `[REDACTED]`; external IDs become `…last4` so que sean correlacionables
 * en debug pero no replay-safe.
 */
function redactPII(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(redactPII);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const k = key.toLowerCase();
      if (PII_KEYS.includes(k)) {
        result[key] = '[REDACTED]';
      } else if (ID_KEYS.includes(k) && typeof value === 'string') {
        result[key] = maskIdValue(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactPII(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

export async function logWebhook(params: {
  tenantId?: string;
  provider: 'whatsapp' | 'stripe' | 'delivery' | 'retell';
  eventType?: string;
  direction?: 'inbound' | 'outbound';
  statusCode?: number;
  payload?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}) {
  try {
    const sanitizedPayload = params.payload
      ? (redactPII(params.payload) as Record<string, unknown>)
      : undefined;

    await supabaseAdmin.from('webhook_logs').insert({
      tenant_id: params.tenantId,
      provider: params.provider,
      event_type: params.eventType,
      direction: params.direction || 'inbound',
      status_code: params.statusCode,
      payload: sanitizedPayload,
      error: params.error,
      duration_ms: params.durationMs,
    });
  } catch {
    // Logging should never break the webhook pipeline
  }
}

/**
 * Guardia de tamaño ANTES de bufferear el payload.
 *
 * Antes: cada route webhook hacía `await req.arrayBuffer()` sin límite. Un
 * atacante con payload de varios MB podía tumbar el worker por OOM antes de
 * llegar a la validación HMAC. Next.js tiene cap implícito (~4.5MB en edge)
 * pero los handlers Node buffean todo lo que les llegue hasta que falle.
 *
 * Devuelve `{ ok: true }` si el header `content-length` está dentro del
 * límite (o falta, en cuyo caso aceptamos y validamos post-read). Devuelve
 * `{ ok: false, response }` con un 413 listo para retornar al caller.
 *
 * El caller DEBE también validar `rawBuffer.byteLength` post-read porque
 * `content-length` puede mentir o faltar (streaming, proxies).
 */
export function enforceWebhookSize(
  req: Request,
  maxBytes: number,
  provider: 'whatsapp' | 'stripe' | 'delivery' | 'retell',
  startTime: number,
): { ok: true } | { ok: false; response: Response } {
  // Compression-bomb defense: 4KB de gzip pueden expandirse a 200MB en RAM.
  // Ningún webhook legítimo (Meta, Stripe, Retell, delivery) usa
  // Content-Encoding: nuestro stack los recibe como JSON plano. Cualquier
  // payload comprimido es una bandera roja → rechazo inmediato pre-buffer.
  const contentEncoding = req.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    logWebhook({
      provider,
      eventType: 'compressed_payload_rejected',
      statusCode: 415,
      error: `Content-Encoding "${contentEncoding}" not allowed (compression-bomb defense)`,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      response: new Response('Compressed payloads not accepted', { status: 415 }),
    };
  }

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > 0 && contentLength > maxBytes) {
    logWebhook({
      provider,
      eventType: 'payload_too_large',
      statusCode: 413,
      error: `Payload ${contentLength} bytes exceeds ${maxBytes}`,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      response: new Response('Payload too large', { status: 413 }),
    };
  }
  return { ok: true };
}

/**
 * Segunda línea de defensa para tamaño — tras leer el buffer, verifica el
 * tamaño real. El `content-length` header puede faltar (streaming) o estar
 * equivocado. Si el buffer real excede, rechazar 413 antes de HMAC.
 */
export function enforceWebhookSizePostRead(
  byteLength: number,
  maxBytes: number,
  provider: 'whatsapp' | 'stripe' | 'delivery' | 'retell',
  startTime: number,
): { ok: true } | { ok: false; response: Response } {
  if (byteLength > maxBytes) {
    logWebhook({
      provider,
      eventType: 'payload_too_large_post_read',
      statusCode: 413,
      error: `Payload ${byteLength} bytes (post-read) exceeds ${maxBytes}`,
      durationMs: Date.now() - startTime,
    });
    return {
      ok: false,
      response: new Response('Payload too large', { status: 413 }),
    };
  }
  return { ok: true };
}

/** Cap estándar para webhooks entrantes. Meta/Stripe/Conekta/Retell/Telnyx
 * raramente pasan de 50KB en payloads reales; 2MB es amplio margen. */
export const WEBHOOK_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Delete webhook logs older than the specified number of days (default: 30).
 * Should be called from a scheduled cron job or admin endpoint.
 */
export async function cleanupWebhookLogs(retentionDays = 30): Promise<{ deleted: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const { count, error } = await supabaseAdmin
    .from('webhook_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoffDate.toISOString());

  if (error) {
    console.error('[webhook-logger] Cleanup failed:', error.message);
    return { deleted: 0 };
  }

  console.log(`[webhook-logger] Cleaned up ${count ?? 0} logs older than ${retentionDays} days`);
  return { deleted: count ?? 0 };
}
