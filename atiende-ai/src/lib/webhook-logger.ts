import { supabaseAdmin } from '@/lib/supabase/admin';

/** Patterns that match PII in webhook payloads */
const PII_KEYS = ['phone', 'phone_number', 'wa_id', 'from', 'to', 'body', 'text', 'message', 'display_phone_number'];

/**
 * Recursively redact PII fields from a payload object.
 * Phone numbers and message content are replaced with '[REDACTED]'.
 */
function redactPII(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(redactPII);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (PII_KEYS.includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
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
  provider: 'whatsapp' | 'stripe' | 'conekta' | 'retell' | 'delivery';
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
