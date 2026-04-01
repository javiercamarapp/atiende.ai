import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';

// ═══════════════════════════════════════════════════════════
// OWNER REAL-TIME NOTIFICATIONS
// Sends WhatsApp alerts to business owner for critical events
// ═══════════════════════════════════════════════════════════

export async function notifyOwner(params: {
  tenantId: string;
  event: 'new_order' | 'new_appointment' | 'complaint' | 'emergency' | 'crisis' | 'lead_hot' | 'order_ready' | 'daily_summary';
  details: string;
}) {
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('wa_phone_number_id, phone, name')
      .eq('id', params.tenantId)
      .single();

    if (!tenant?.phone || !tenant?.wa_phone_number_id) return;

    const icons: Record<string, string> = {
      new_order: '🧾',
      new_appointment: '📅',
      complaint: '🚨',
      emergency: '🆘',
      crisis: '⚠️',
      lead_hot: '🔥',
      order_ready: '✅',
      daily_summary: '📊',
    };

    const msg = `${icons[params.event] || '🔔'} ${params.event.replace(/_/g, ' ').toUpperCase()}\n\n${params.details}\n\n— ${tenant.name} Bot`;

    await sendTextMessage(tenant.wa_phone_number_id, tenant.phone, msg);
  } catch {
    // Best effort — never break the pipeline
  }
}
