import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendButtonMessage, sendLocation } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import type { AgentContext } from '../engine';

export async function runCobrador(ctx: AgentContext) {
  const { data: unpaid } = await supabaseAdmin
    .from('appointments')
    .select('customer_phone, customer_name, id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'completed')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  for (const apt of unpaid || []) {
    if (!apt.customer_phone) continue;
    await sendTextMessage(
      ctx.tenant.wa_phone_number_id as string,
      apt.customer_phone,
      `Hola ${apt.customer_name || ''}, le recordamos su pago pendiente en ${ctx.tenant.name}. ¿Necesita ayuda con el pago? Responda a este mensaje.`
    );
  }
}

export async function runSeguimiento(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const serviceName = payload?.service_name || 'su servicio';
  if (!phone) return;

  const response = await generateResponse({
    model: MODELS.STANDARD,
    system: `Eres asistente de ${ctx.tenant.name}. Genera instrucciones breves de cuidado post-servicio para: ${serviceName}. Máximo 3 puntos. En español mexicano.`,
    messages: [{ role: 'user', content: `Instrucciones de cuidado para ${serviceName}` }],
    temperature: 0.3,
  });

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `📋 Instrucciones post-servicio:\n\n${response.text}`
  );
}

export async function runOptimizador(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const staffId = payload?.staff_id;
  const datetime = payload?.datetime;
  if (!staffId || !datetime) return;

  const { data: waitlist } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, content')
    .eq('tenant_id', ctx.tenantId)
    .eq('direction', 'inbound')
    .eq('intent', 'APPOINTMENT_NEW')
    .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
    .limit(10);

  if (!waitlist?.length) return;

  for (const msg of waitlist) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('customer_phone')
      .eq('id', msg.conversation_id)
      .single();

    if (conv?.customer_phone) {
      await sendTextMessage(
        ctx.tenant.wa_phone_number_id as string,
        conv.customer_phone,
        `¡Buenas noticias! Se liberó un espacio en ${ctx.tenant.name}. ¿Le gustaría agendar? Responda "Sí" para confirmar.`
      );
    }
  }
}

export async function runBilingue(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const conversationId = payload?.conversation_id;
  const firstMessage = payload?.content;
  if (!conversationId || !firstMessage) return;

  const englishPatterns = /\b(hello|hi|good morning|how are you|thanks|thank you|appointment|book|price|menu)\b/i;
  const isEnglish = englishPatterns.test(firstMessage);

  if (isEnglish) {
    await supabaseAdmin.from('conversations')
      .update({ tags: ['english'] })
      .eq('id', conversationId);
  }
}

export async function runInventario(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, unknown> | undefined;
  const items = payload?.items as Array<{ name: string }> | undefined;
  if (!items?.length) return;

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('name, active')
    .eq('tenant_id', ctx.tenantId);

  const activeNames = new Set((services || []).filter(s => s.active).map(s => s.name.toLowerCase()));
  const unavailable = items.filter(i => !activeNames.has(i.name.toLowerCase()));

  if (unavailable.length > 0) {
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: ctx.tenantId,
      action: 'inventario.items_unavailable',
      details: { unavailable: unavailable.map(i => i.name) },
    });
  }
}

export async function runConfirmacionCita(ctx: AgentContext) {
  const tomorrow = new Date(Date.now() + 24 * 3600000);
  const tomorrowStart = tomorrow.toISOString().split('T')[0] + 'T00:00:00';
  const tomorrowEnd = tomorrow.toISOString().split('T')[0] + 'T23:59:59';

  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, customer_phone, customer_name, datetime, reminder_24h_sent')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'scheduled')
    .gte('datetime', tomorrowStart)
    .lte('datetime', tomorrowEnd);

  for (const apt of appointments || []) {
    if (!apt.customer_phone) continue;
    const time = new Date(apt.datetime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    await sendButtonMessage(
      ctx.tenant.wa_phone_number_id as string,
      apt.customer_phone,
      `Hola ${apt.customer_name || ''}, le recordamos su cita mañana a las ${time} en ${ctx.tenant.name}. ¿Puede confirmar?`,
      [
        '✅ Confirmar',
        '❌ Cancelar',
        '📅 Reagendar',
      ]
    );
  }
}

export async function runListaEspera(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const staffId = payload?.staff_id;
  const serviceId = payload?.service_id;
  if (!staffId && !serviceId) return;

  const { data: recentRequests } = await supabaseAdmin
    .from('messages')
    .select('conversation_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('intent', 'APPOINTMENT_NEW')
    .eq('direction', 'inbound')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(5);

  for (const msg of recentRequests || []) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('customer_phone, customer_name')
      .eq('id', msg.conversation_id)
      .single();

    if (conv?.customer_phone) {
      await sendButtonMessage(
        ctx.tenant.wa_phone_number_id as string,
        conv.customer_phone,
        `¡Se acaba de liberar un espacio en ${ctx.tenant.name}! ¿Le gustaría tomarlo?`,
        [
          '✅ Sí, agendar',
          '❌ No, gracias',
        ]
      );
    }
  }
}

export async function runMenuCatalogo(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  if (!phone) return;

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('name, price, description, category')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .order('category');

  if (!services?.length) return;

  const catalog = services.map(s =>
    `• ${s.name}${s.price ? ` - $${s.price} MXN` : ''}${s.description ? ` (${s.description})` : ''}`
  ).join('\n');

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `📄 Nuestros servicios en ${ctx.tenant.name}:\n\n${catalog.slice(0, 550)}`
  );
}

export async function runDirecciones(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  if (!phone) return;

  const lat = ctx.tenant.lat as number;
  const lng = ctx.tenant.lng as number;

  if (lat && lng) {
    await sendLocation(
      ctx.tenant.wa_phone_number_id as string,
      phone,
      lat,
      lng,
      ctx.tenant.name as string,
      ctx.tenant.address as string || ''
    );
  } else {
    await sendTextMessage(
      ctx.tenant.wa_phone_number_id as string,
      phone,
      `📍 Nos encontramos en: ${ctx.tenant.address || 'Consulte nuestra ubicación en Google Maps'}`
    );
  }
}

export async function runHorarioFuera(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  if (!phone) return;

  const hours = ctx.tenant.business_hours as Record<string, string> | null;
  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowDay = days[tomorrow.getDay()];
  const tomorrowHours = hours?.[tomorrowDay] || '09:00-18:00';
  const openTime = tomorrowHours.split('-')[0] || '09:00';

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `🌙 Gracias por escribirnos. En este momento estamos fuera de horario. Abrimos mañana a las ${openTime}. Le responderemos a primera hora. ¡Que tenga buena noche!`
  );
}
