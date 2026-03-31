import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import type { AgentContext } from '../engine';

export async function runCalificador(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const conversationId = payload?.conversation_id;
  const contactId = payload?.contact_id;
  const content = payload?.content;
  if (!conversationId || !content) return;

  const response = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: 'Analyze this message for BANT lead qualification. Return JSON: {"budget":0-25,"authority":0-25,"need":0-25,"timeline":0-25,"total":0-100}. Only return the JSON.',
    messages: [{ role: 'user', content }],
    temperature: 0.1,
  });

  try {
    const score = JSON.parse(response.text);
    const temp = score.total >= 70 ? 'hot' : score.total >= 40 ? 'warm' : 'cold';

    if (contactId) {
      await supabaseAdmin.from('leads').upsert({
        tenant_id: ctx.tenantId,
        contact_id: contactId,
        conversation_id: conversationId,
        score: score.total,
        temperature: temp,
        budget: String(score.budget),
        authority: String(score.authority),
        need: String(score.need),
        timeline: String(score.timeline),
      }, { onConflict: 'tenant_id,contact_id' });
    }
  } catch { /* AI didn't return valid JSON */ }
}

export async function runUpselling(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const serviceName = payload?.service_name;
  if (!phone || !serviceName) return;

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('name, price, description')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .neq('name', serviceName)
    .limit(3);

  if (!services?.length) return;

  const suggestions = services.map(s => `• ${s.name} - $${s.price} MXN`).join('\n');
  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `¡Gracias por su visita! 💎 Servicios que complementan "${serviceName}":\n\n${suggestions}\n\n¿Le gustaría agendar alguno?`
  );
}

export async function runNurturing(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const name = payload?.customer_name || '';
  if (!phone) return;

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `Hola ${name}, gracias por su interés en ${ctx.tenant.name}. ¿Tiene alguna pregunta que pueda resolverle?`
  );

  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'nurturing.sequence_started',
    details: { phone, name, day: 1, next_days: [3, 7, 14] },
  });
}

export async function runLinkPago(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const amount = payload?.amount;
  if (!phone || !amount) return;

  const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/pay/${ctx.tenantId}?amount=${amount}`;

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `💳 Aquí tiene su link de pago por $${amount} MXN:\n${paymentUrl}\n\nPuede pagar con tarjeta, OXXO o SPEI.`
  );
}
