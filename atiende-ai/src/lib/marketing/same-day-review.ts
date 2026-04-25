// ═════════════════════════════════════════════════════════════════════════════
// SAME-DAY REVIEW TRIGGER (Phase 3)
//
// Cuando un paciente nos manda mensaje el mismo día que tuvo su cita
// completada, le pedimos reseña al final del bot reply. Es el momento de
// máxima satisfacción + estamos dentro de la 24h-window de WhatsApp +
// el paciente está engaged en una conversación.
//
// vs el cron `reputacion`: el cron espera 24h post-encuesta, requiere survey
// rating=excellent. Este trigger es opportunistic — si justo el paciente
// nos escribe el día de la cita, no perdemos la oportunidad.
//
// Reglas:
//   - tenant debe tener google_review_url O google_place_id
//   - contact tiene cita completada HOY (en tz del tenant)
//   - contact.review_requested = false (idempotencia, una sola vez por
//     paciente, ever)
//   - el bot ya respondió al usuario (esto se llama post-response side-effect)
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessageSafe } from '@/lib/whatsapp/send';
import { resolveTenantTimezone } from '@/lib/config';

interface MaybeRequestReviewArgs {
  tenant: Record<string, unknown>;
  phoneNumberId: string;
  senderPhone: string;
  conversationId: string;
  contactId: string;
}

function buildReviewUrl(tenant: Record<string, unknown>): string | null {
  const direct = (tenant.google_review_url as string | null) || null;
  if (direct && direct.startsWith('http')) return direct;
  const placeId = (tenant.google_place_id as string | null) || null;
  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${placeId}`;
  }
  return null;
}

function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}

/**
 * Si el paciente tuvo una cita completada hoy y aún no se le pidió reseña,
 * envía un mensaje breve agradeciendo + link de reseña, y marca
 * review_requested=true para no volver a pedir.
 *
 * Devuelve true si efectivamente envió el mensaje, false si no aplicaba.
 */
export async function maybeRequestSameDayReview(
  args: MaybeRequestReviewArgs,
): Promise<boolean> {
  const { tenant, phoneNumberId, senderPhone, conversationId, contactId } = args;
  if (!contactId) return false;

  const reviewUrl = buildReviewUrl(tenant);
  if (!reviewUrl) return false;

  const tenantId = tenant.id as string;
  const tz = resolveTenantTimezone(tenant);
  const today = todayInTz(tz);

  // 1. ¿El paciente ya recibió la solicitud antes? (idempotencia ever)
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id, name, review_requested')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!contact || contact.review_requested === true) return false;

  // 2. ¿Hay cita completada HOY del paciente?
  // Audit fix: forzamos UTC con sufijo Z. Antes `new Date('${today}T00:00:00')`
  // se interpretaba en timezone del server (Vercel = UTC pero local dev
  // podría ser otra), causando drift entre tenant TZ y query window.
  const dayStart = new Date(`${today}T00:00:00Z`);
  // Margen amplio (36h) para cubrir casos de TZ shift sin sobre-engineer.
  // El check exacto contra TZ del tenant viene en el step 3 con
  // Intl.DateTimeFormat.
  const windowStart = new Date(dayStart.getTime() - 24 * 3600_000);
  const windowEnd = new Date(dayStart.getTime() + 36 * 3600_000);

  const { data: aptToday } = await supabaseAdmin
    .from('appointments')
    .select('id, datetime, status')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'completed')
    .gte('datetime', windowStart.toISOString())
    .lt('datetime', windowEnd.toISOString())
    .order('datetime', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!aptToday) return false;

  // 3. Verificar que la cita realmente cae HOY en TZ del tenant (el rango
  // de arriba es laxo; este check es exacto).
  const aptDayLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(aptToday.datetime as string));
  if (aptDayLocal !== today) return false;

  // 4. ¿El paciente ya dejó reseña en Google? (si tenemos sync activo)
  // Match fuzzy por primer nombre. Si encontramos, evitamos pedir doble.
  const firstName = ((contact.name as string | null) || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .split(/\s+/)[0];
  if (firstName && firstName.length >= 2) {
    const { data: existing } = await supabaseAdmin
      .from('google_reviews')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('reviewer_name', `%${firstName}%`)
      .limit(1);
    if (existing && existing.length > 0) {
      // Marcamos requested para no reintentar nunca, pero NO mandamos.
      await supabaseAdmin
        .from('contacts')
        .update({ review_requested: true, review_requested_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('tenant_id', tenantId);
      return false;
    }
  }

  // 5. Enviar el mensaje. Tono cálido, corto, mismo día.
  const businessName = (tenant.name as string) || 'el consultorio';
  const text =
    `Una cosita más antes de despedirnos: si la consulta de hoy le gustó, ` +
    `nos ayudaría muchísimo dejar una reseña en Google ${'✨'}\n\n` +
    `${reviewUrl}\n\n` +
    `Toma 1 minuto y nos ayuda a que más pacientes encuentren a ${businessName}. ¡Gracias!`;

  // Audit fix: usar sendTextMessageSafe para chequear 24h-window de WhatsApp
  // Business. Si el último inbound del paciente es >24h, Meta rechaza el
  // mensaje libre (error 131047). Aunque acá venimos de un inbound activo,
  // el chequeo da margen + retry/fallback.
  try {
    const r = await sendTextMessageSafe(phoneNumberId, senderPhone, text, {
      tenantId: tenantId,
    });
    if (!r.ok) {
      // 24h window expirada o send falló — marcamos requested para no
      // reintentar mañana (ya pasó el momento óptimo).
      await supabaseAdmin
        .from('contacts')
        .update({ review_requested: true, review_requested_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('tenant_id', tenantId);
      return false;
    }
  } catch (err) {
    console.warn('[same-day-review] send failed:', err instanceof Error ? err.message : err);
    return false;
  }

  // Persistimos el outbound + marcamos contacto.
  await Promise.all([
    supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      direction: 'outbound',
      sender_type: 'bot',
      content: text,
      message_type: 'text',
      intent: 'review.same_day_request',
    }),
    supabaseAdmin
      .from('contacts')
      .update({
        review_requested: true,
        review_requested_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('tenant_id', tenantId),
  ]);

  return true;
}
