import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';

// ═══════════════════════════════════════════════════════════
// OWNER REAL-TIME NOTIFICATIONS
// Sends WhatsApp alerts to business owner for critical events
// ═══════════════════════════════════════════════════════════

type OwnerEvent =
  | 'new_order'
  | 'new_appointment'
  | 'complaint'
  | 'emergency'
  | 'crisis'
  | 'lead_hot'
  | 'order_ready'
  | 'daily_summary';

const EVENT_ICONS: Record<OwnerEvent, string> = {
  new_order: '🧾',
  new_appointment: '📅',
  complaint: '🚨',
  emergency: '🆘',
  crisis: '⚠️',
  lead_hot: '🔥',
  order_ready: '✅',
  daily_summary: '📊',
};

export interface NotifyOwnerResult {
  ok: boolean;
  error?: string;
  /** Código de error Meta si aplica (131047 = fuera de ventana 24h, etc.). */
  errorCode?: number;
}

/**
 * Notifica al dueño vía WhatsApp. RETORNA un resultado estructurado —
 * el caller decide si tolerar la falla (legacy) o persistir el error
 * para reintento (book_appointment + cron/notify-retry).
 */
export async function notifyOwner(params: {
  tenantId: string;
  event: OwnerEvent;
  details: string;
}): Promise<NotifyOwnerResult> {
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('wa_phone_number_id, phone, name')
      .eq('id', params.tenantId)
      .single();

    if (!tenant?.phone || !tenant?.wa_phone_number_id) {
      return { ok: false, error: 'owner_phone_or_wa_id_missing' };
    }

    const msg = `${EVENT_ICONS[params.event] || '🔔'} ${params.event.replace(/_/g, ' ').toUpperCase()}\n\n${params.details}\n\n— ${tenant.name} Bot`;
    const sendResult = await sendTextMessage(tenant.wa_phone_number_id, tenant.phone, msg);
    if (!sendResult.ok) {
      return {
        ok: false,
        error: sendResult.errorLabel || sendResult.errorMessage || 'send_failed',
        errorCode: sendResult.errorCode,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
