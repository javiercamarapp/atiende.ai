import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import type { AgentContext } from '../engine';

export async function runResenas(ctx: AgentContext) {
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: completed } = await supabaseAdmin
    .from('appointments')
    .select('customer_phone, customer_name')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'completed')
    .gte('updated_at', yesterday);

  for (const apt of completed || []) {
    if (!apt.customer_phone) continue;
    const googleUrl = ctx.tenant.google_place_id
      ? `https://search.google.com/local/writereview?placeid=${ctx.tenant.google_place_id}`
      : '';
    await sendTextMessage(
      ctx.tenant.wa_phone_number_id as string,
      apt.customer_phone,
      `¡Gracias por su visita a ${ctx.tenant.name}! ¿Nos regalaría una reseña? Nos ayuda mucho 🙏${googleUrl ? `\n${googleUrl}` : ''}`
    );
  }
}

export async function runReactivacion(ctx: AgentContext) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: inactive } = await supabaseAdmin
    .from('contacts')
    .select('phone, name')
    .eq('tenant_id', ctx.tenantId)
    .lt('last_contact_at', ninetyDaysAgo)
    .limit(50);

  for (const contact of inactive || []) {
    await sendTextMessage(
      ctx.tenant.wa_phone_number_id as string,
      contact.phone,
      `Hola ${contact.name || ''}, le extrañamos en ${ctx.tenant.name}. Tenemos algo especial para usted. ¿Le gustaría agendar una cita?`
    );
  }
}

export async function runCumpleanos(ctx: AgentContext) {
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('phone, name, metadata')
    .eq('tenant_id', ctx.tenantId);

  for (const c of contacts || []) {
    const meta = c.metadata as Record<string, string> | null;
    if (!meta?.birthday || !meta.birthday.endsWith(mmdd)) continue;
    await sendTextMessage(
      ctx.tenant.wa_phone_number_id as string,
      c.phone,
      `🎂 ¡Feliz cumpleaños ${c.name || ''}! De parte de todo el equipo de ${ctx.tenant.name}. Tenemos un regalo especial para usted. ¡Escríbanos para más detalles!`
    );
  }
}

export async function runReferidos(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  if (!phone) return;

  const code = `REF-${ctx.tenantId.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `¡Gracias por su reseña positiva! 🤝 Recomiéndenos y ambos ganan. Comparta este código con amigos: ${code}. Cuando agenden, ambos reciben un beneficio especial.`
  );
}

export async function runRedesSociales(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'redes_sociales.comment_received',
    details: { platform: payload?.platform, comment: payload?.comment },
  });
}

export async function runHappyHour(ctx: AgentContext) {
  const { data: recentContacts } = await supabaseAdmin
    .from('contacts')
    .select('phone, name')
    .eq('tenant_id', ctx.tenantId)
    .gte('last_contact_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .limit(100);

  const promoMsg = (ctx.config as Record<string, string>).promo_message
    || `🎉 ¡Promoción especial en ${ctx.tenant.name}! Pregunte por nuestras ofertas del día.`;

  for (const c of recentContacts || []) {
    await sendTextMessage(ctx.tenant.wa_phone_number_id as string, c.phone, promoMsg);
  }
}

export async function runRespuestaResenas(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const reviewText = payload?.review_text;
  const reviewerName = payload?.reviewer_name || 'Cliente';
  const rating = payload?.rating;
  if (!reviewText) return;

  const response = await generateResponse({
    model: MODELS.STANDARD,
    system: `Eres el dueño de ${ctx.tenant.name}. Genera una respuesta profesional y cálida a esta reseña de Google. Máximo 3 oraciones. En español mexicano.`,
    messages: [{ role: 'user', content: `Reseña de ${reviewerName} (${rating}⭐): "${reviewText}"` }],
    temperature: 0.5,
  });

  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'respuesta_resenas.generated',
    details: { reviewer: reviewerName, rating, response: response.text },
  });
}
