// ═════════════════════════════════════════════════════════════════════════════
// alertOnCronFailure — notifica a Javier (admin) cuando un cron falla.
// Sin esto, los fallos solo quedan en cron_runs (observable via query pero no proactive).
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Envía WhatsApp a Javier cuando un cron registra fallos. Best-effort:
 * si no hay configuración, silencia (no bloquea el cron).
 *
 * Requiere:
 *   - env var JAVIER_PHONE (formato WhatsApp MX: 521XXXXXXXXXX)
 *   - Al menos un tenant activo con wa_phone_number_id (lo usa como outbound).
 */
export async function alertOnCronFailure(
  jobName: string,
  tenantCount: number,
  failureCount: number,
  error?: string,
): Promise<void> {
  // No-op si no hay fallos
  if (failureCount === 0 && !error) return;

  const javierPhone = process.env.JAVIER_PHONE;
  if (!javierPhone) {
    console.warn('[alertOnCronFailure] JAVIER_PHONE no configurado — skipping notification');
    return;
  }

  try {
    // Necesitamos un wa_phone_number_id activo para enviar. Usamos cualquier
    // tenant activo (el sistema multi-tenant tiene varios, basta con uno).
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('wa_phone_number_id')
      .eq('status', 'active')
      .not('wa_phone_number_id', 'is', null)
      .limit(1)
      .maybeSingle();

    const phoneNumberId = (tenant as { wa_phone_number_id?: string } | null)?.wa_phone_number_id;
    if (!phoneNumberId) {
      console.warn('[alertOnCronFailure] no active tenant with wa_phone_number_id');
      return;
    }

    const { sendTextMessage } = await import('@/lib/whatsapp/send');
    const errSnippet = error ? error.slice(0, 100) : '';
    const body =
      `🚨 Cron falló: ${jobName}\n` +
      `Tenants: ${failureCount}/${tenantCount} fallaron\n` +
      (errSnippet ? `Error: ${errSnippet}\n` : '') +
      `Revisar: cron_runs en Supabase`;

    await sendTextMessage(phoneNumberId, javierPhone, body);
  } catch (err) {
    // Nunca fallar el cron por un error de alerta
    console.error('[alertOnCronFailure] failed to send alert:', err);
  }
}
