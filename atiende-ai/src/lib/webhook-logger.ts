import { supabaseAdmin } from '@/lib/supabase/admin';

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
    await supabaseAdmin.from('webhook_logs').insert({
      tenant_id: params.tenantId,
      provider: params.provider,
      event_type: params.eventType,
      direction: params.direction || 'inbound',
      status_code: params.statusCode,
      payload: params.payload,
      error: params.error,
      duration_ms: params.durationMs,
    });
  } catch {
    // Logging should never break the webhook pipeline
  }
}
