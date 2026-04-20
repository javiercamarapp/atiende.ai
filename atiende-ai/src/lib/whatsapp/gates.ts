// ═════════════════════════════════════════════════════════════════════════════
// GATES — controles de entrada antes de procesar un mensaje de WhatsApp
//
// Extraído de processor.ts (AUDIT sub-agent 4 "God Object"). Estas checks
// corren ANTES de la ingestión/LLM; rechazan tráfico no deseado, tenants
// inactivos, o usuarios fuera de cuota. Si cualquiera falla, se responde
// algo útil al usuario y se devuelve `false` para abortar el pipeline.
//
// Orden de checks (más barato primero):
//   1. Rate limit per-phone (Redis) — DDoS defensa inmediata
//   2. Rate limit per-tenant (Redis) — burst cap 1/10 del limit horario
//   3. Trial expiry — si plan=free_trial y expiró → mensaje + abort
//   4. Monthly cap atómico — reserveMonthlyMessage (INCR + rollback si >limit)
//
// NOTA: El bot atiende 24/7 independientemente del horario del negocio. El
// horario (business_hours) se respeta solo al momento de reservar citas —
// lo aplica el tool check_availability / book_appointment del agente AGENDA.
// ═════════════════════════════════════════════════════════════════════════════

import { sendTextMessage } from '@/lib/whatsapp/send';
import { checkRateLimit, checkTenantLimit, checkTenantRateLimit } from '@/lib/rate-limit';

/** Shape mínimo del tenant que necesitan los gates. */
export interface GatesTenant {
  id: string;
  plan: string;
  trial_ends_at?: string | null;
  business_hours?: Record<string, string> | null;
  [key: string]: unknown;
}

/** Límites de mensajes outbound por plan (mes calendario, UTC). */
const PLAN_MSG_LIMITS: Record<string, number> = {
  free_trial: 50,
  basic: 500,
  pro: 2000,
  premium: 10000,
};

/**
 * Ejecuta todos los gates. Si alguno bloquea, envía un mensaje al usuario
 * y retorna `false`. Si todos pasan, retorna `true` (ya reservó 1 slot del
 * cap mensual — el caller debe llamar `releaseMonthlyReservation` si aborta
 * antes de enviar respuesta).
 */
export async function runGates(
  tenant: GatesTenant,
  senderPhone: string,
  phoneNumberId: string,
): Promise<boolean> {
  // 1. Phone rate limit (per-sender, protege contra DDoS de un solo número)
  const rateLimited = await checkRateLimit(senderPhone);
  if (!rateLimited.allowed) return false;

  // 2. Tenant rate limit — burst-cap SEC-4 (1/10 del límite horario por min)
  const tenantLimited = await checkTenantRateLimit(tenant.id, tenant.plan, senderPhone);
  if (!tenantLimited.allowed) {
    if (tenantLimited.reason === 'burst') {
      console.warn('[gates] tenant burst rate-limit', { tenantId: tenant.id });
    }
    return false;
  }
  // Mantengo checkTenantLimit referenciado para no romper el deprecated path
  void checkTenantLimit;

  // 3. Trial expiry
  if (tenant.plan === 'free_trial' && tenant.trial_ends_at) {
    const trialEnd = new Date(tenant.trial_ends_at as string);
    if (trialEnd < new Date()) {
      await sendTextMessage(
        phoneNumberId,
        senderPhone,
        'Tu periodo de prueba ha terminado. Para seguir usando nuestro servicio, por favor actualiza tu plan en el panel de administracion. Gracias por probar nuestro servicio.',
      );
      return false;
    }
  }

  // 4. Monthly cap — reserva ATÓMICA en Redis (AUDIT R14 BUG-002).
  // INCR + DECR si excede; garantiza que concurrent webhooks NO pueden pasar
  // el mismo count desfasado al LLM.
  const monthlyLimit = PLAN_MSG_LIMITS[tenant.plan] ?? 50;
  const { reserveMonthlyMessage } = await import('@/lib/rate-limit-monthly');
  const reservation = await reserveMonthlyMessage(tenant.id, monthlyLimit);
  if (!reservation.allowed) {
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Hemos alcanzado el limite de mensajes de este mes para tu plan. Para continuar recibiendo respuestas automaticas, por favor actualiza tu plan. Disculpa las molestias.',
    );
    return false;
  }

  return true;
}
