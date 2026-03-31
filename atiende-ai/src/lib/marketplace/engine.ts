import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTemplate, sendButtonMessage, sendLocation } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';

// ═══════════════════════════════════════════════════════════
// MARKETPLACE AGENT EXECUTION ENGINE
// Runs 25 marketplace agents (15 original + 10 new)
// ═══════════════════════════════════════════════════════════

interface AgentContext {
  tenantId: string;
  agentSlug: string;
  config: Record<string, unknown>;
  tenant: Record<string, unknown>;
}

// ── CRON EXECUTOR ──────────────────────────────────────────
export async function executeCronAgents(schedule: string) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng, business_hours)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0 };

  let executed = 0;
  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'cron') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.schedule !== schedule) continue;

    try {
      const tenant = ta.tenant as unknown as Record<string, unknown>;
      await runAgent(agent.slug as string, {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: (ta.config as Record<string, unknown>) || {},
        tenant,
      });
      await supabaseAdmin.from('tenant_agents').update({
        last_run_at: new Date().toISOString(),
        run_count: ((ta.run_count as number) || 0) + 1,
      }).eq('id', ta.id);
      executed++;
    } catch (err) {
      console.error(`Agent ${(agent.slug as string)} failed for tenant ${ta.tenant_id}:`, err);
    }
  }
  return { executed };
}

// ── EVENT EXECUTOR ─────────────────────────────────────────
export async function executeEventAgents(eventName: string, payload: Record<string, unknown>) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0 };

  let executed = 0;
  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'event') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.event !== eventName) continue;

    try {
      const tenant = ta.tenant as unknown as Record<string, unknown>;
      await runAgent(agent.slug as string, {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: { ...(ta.config as Record<string, unknown>), eventPayload: payload },
        tenant,
      });
      await supabaseAdmin.from('tenant_agents').update({
        last_run_at: new Date().toISOString(),
        run_count: ((ta.run_count as number) || 0) + 1,
      }).eq('id', ta.id);
      executed++;
    } catch (err) {
      console.error(`Agent ${(agent.slug as string)} failed:`, err);
    }
  }
  return { executed };
}

// ── AGENT ROUTER ───────────────────────────────────────────
async function runAgent(slug: string, ctx: AgentContext) {
  const handlers: Record<string, (c: AgentContext) => Promise<void>> = {
    // Original 15
    cobrador: runCobrador,
    resenas: runResenas,
    reactivacion: runReactivacion,
    cumpleanos: runCumpleanos,
    referidos: runReferidos,
    nps: runNPS,
    reportes: runReportes,
    faq_builder: runFAQBuilder,
    seguimiento: runSeguimiento,
    optimizador: runOptimizador,
    bilingue: runBilingue,
    inventario: runInventario,
    calificador: runCalificador,
    upselling: runUpselling,
    redes_sociales: runRedesSociales,
    // New 10
    confirmacion_cita: runConfirmacionCita,
    lista_espera: runListaEspera,
    menu_catalogo: runMenuCatalogo,
    link_pago: runLinkPago,
    direcciones: runDirecciones,
    happy_hour: runHappyHour,
    rendimiento_staff: runRendimientoStaff,
    nurturing: runNurturing,
    respuesta_resenas: runRespuestaResenas,
    horario_fuera: runHorarioFuera,
  };
  const handler = handlers[slug];
  if (handler) await handler(ctx);
}

// ═══════════════════════════════════════════════════════════
// ORIGINAL 15 AGENTS
// ═══════════════════════════════════════════════════════════

async function runCobrador(ctx: AgentContext) {
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

async function runResenas(ctx: AgentContext) {
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

async function runReactivacion(ctx: AgentContext) {
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

async function runCumpleanos(ctx: AgentContext) {
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

async function runReferidos(ctx: AgentContext) {
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

async function runNPS(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const name = payload?.customer_name || '';
  if (!phone) return;

  await sendButtonMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `Hola ${name}, ¿cómo calificaría su experiencia en ${ctx.tenant.name}?`,
    [
      '⭐ Excelente (9-10)',
      '👍 Buena (7-8)',
      '😐 Podemos mejorar',
    ]
  );
}

async function runReportes(ctx: AgentContext) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: analytics } = await supabaseAdmin
    .from('daily_analytics')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .gte('date', weekAgo);

  if (!analytics?.length) return;

  const totals = analytics.reduce((acc, d) => ({
    msgs: acc.msgs + (d.messages_inbound || 0) + (d.messages_outbound || 0),
    appointments: acc.appointments + (d.appointments_booked || 0),
    noShows: acc.noShows + (d.appointments_no_show || 0),
    revenue: acc.revenue + Number(d.orders_revenue || 0),
    saved: acc.saved + Number(d.estimated_savings_mxn || 0),
  }), { msgs: 0, appointments: 0, noShows: 0, revenue: 0, saved: 0 });

  const report = `📈 Reporte semanal de ${ctx.tenant.name}:\n\n` +
    `💬 Mensajes: ${totals.msgs}\n` +
    `📅 Citas agendadas: ${totals.appointments}\n` +
    `❌ No-shows: ${totals.noShows}\n` +
    `💰 Revenue: $${totals.revenue.toLocaleString()} MXN\n` +
    `✅ Ahorro estimado: $${totals.saved.toLocaleString()} MXN`;

  if (ctx.tenant.phone) {
    await sendTextMessage(ctx.tenant.wa_phone_number_id as string, ctx.tenant.phone as string, report);
  }
}

async function runFAQBuilder(ctx: AgentContext) {
  const { data: lowConf } = await supabaseAdmin
    .from('messages')
    .select('content, intent')
    .eq('tenant_id', ctx.tenantId)
    .eq('direction', 'inbound')
    .lt('confidence', 0.5)
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(50);

  if (!lowConf?.length) return;

  // Group similar questions and log for knowledge base improvement
  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'faq_builder.gaps_detected',
    entity_type: 'knowledge_chunks',
    details: { count: lowConf.length, samples: lowConf.slice(0, 10).map(m => m.content) },
  });
}

async function runSeguimiento(ctx: AgentContext) {
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

async function runOptimizador(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const staffId = payload?.staff_id;
  const datetime = payload?.datetime;
  if (!staffId || !datetime) return;

  // Find contacts who recently asked for same staff
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

async function runBilingue(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const conversationId = payload?.conversation_id;
  const firstMessage = payload?.content;
  if (!conversationId || !firstMessage) return;

  // Simple language detection
  const englishPatterns = /\b(hello|hi|good morning|how are you|thanks|thank you|appointment|book|price|menu)\b/i;
  const isEnglish = englishPatterns.test(firstMessage);

  if (isEnglish) {
    await supabaseAdmin.from('conversations')
      .update({ tags: ['english'] })
      .eq('id', conversationId);
  }
}

async function runInventario(ctx: AgentContext) {
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

async function runCalificador(ctx: AgentContext) {
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

async function runUpselling(ctx: AgentContext) {
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

async function runRedesSociales(ctx: AgentContext) {
  // Placeholder — log social comment event for future IG/FB integration
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'redes_sociales.comment_received',
    details: { platform: payload?.platform, comment: payload?.comment },
  });
}

// ═══════════════════════════════════════════════════════════
// NEW 10 AGENTS
// ═══════════════════════════════════════════════════════════

async function runConfirmacionCita(ctx: AgentContext) {
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

async function runListaEspera(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const staffId = payload?.staff_id;
  const serviceId = payload?.service_id;
  if (!staffId && !serviceId) return;

  // Find recent contacts who asked for appointments but didn't get one
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

async function runMenuCatalogo(ctx: AgentContext) {
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

async function runLinkPago(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const amount = payload?.amount;
  if (!phone || !amount) return;

  // In production, this would generate a real Conekta/Stripe payment link
  const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/pay/${ctx.tenantId}?amount=${amount}`;

  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `💳 Aquí tiene su link de pago por $${amount} MXN:\n${paymentUrl}\n\nPuede pagar con tarjeta, OXXO o SPEI.`
  );
}

async function runDirecciones(ctx: AgentContext) {
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

async function runHappyHour(ctx: AgentContext) {
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

async function runRendimientoStaff(ctx: AgentContext) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: staff } = await supabaseAdmin
    .from('staff')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  if (!staff?.length) return;

  const lines: string[] = [];
  for (const s of staff) {
    const { count } = await supabaseAdmin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', s.id)
      .gte('created_at', weekAgo);

    lines.push(`• ${s.name}: ${count || 0} citas`);
  }

  const report = `👥 Rendimiento semanal:\n\n${lines.join('\n')}`;
  if (ctx.tenant.phone) {
    await sendTextMessage(ctx.tenant.wa_phone_number_id as string, ctx.tenant.phone as string, report);
  }
}

async function runNurturing(ctx: AgentContext) {
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const name = payload?.customer_name || '';
  if (!phone) return;

  // Day 1 message (immediately on lead creation)
  await sendTextMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `Hola ${name}, gracias por su interés en ${ctx.tenant.name}. ¿Tiene alguna pregunta que pueda resolverle?`
  );

  // Schedule follow-ups via audit log (a cron would pick these up)
  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'nurturing.sequence_started',
    details: { phone, name, day: 1, next_days: [3, 7, 14] },
  });
}

async function runRespuestaResenas(ctx: AgentContext) {
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

async function runHorarioFuera(ctx: AgentContext) {
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
