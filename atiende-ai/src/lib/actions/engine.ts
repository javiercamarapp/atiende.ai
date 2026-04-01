import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';

// ═══════════════════════════════════════════════════════════
// AGENTIC ACTION ENGINE — Bots que HACEN, no solo HABLAN
// Each intent triggers a REAL action: DB writes, calendar sync, CRM updates
// ═══════════════════════════════════════════════════════════

interface ActionContext {
  tenantId: string;
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  contactId: string;
  conversationId: string;
  intent: string;
  content: string;
  businessType: string;
  tenant: Record<string, unknown>;
}

interface ActionResult {
  actionTaken: boolean;
  actionType?: string;
  details?: Record<string, unknown>;
  followUpMessage?: string;
}

export async function executeAction(ctx: ActionContext): Promise<ActionResult> {
  const handlers: Record<string, (c: ActionContext) => Promise<ActionResult>> = {
    APPOINTMENT_NEW: handleNewAppointment,
    APPOINTMENT_MODIFY: handleModifyAppointment,
    APPOINTMENT_CANCEL: handleCancelAppointment,
    ORDER_NEW: handleNewOrder,
    ORDER_STATUS: handleOrderStatus,
    RESERVATION: handleReservation,
    COMPLAINT: handleComplaint,
    EMERGENCY: handleEmergency,
    HUMAN: handleHumanRequest,
    CRISIS: handleCrisis,
  };

  const handler = handlers[ctx.intent];
  if (!handler) return { actionTaken: false };

  try {
    const result = await handler(ctx);
    if (result.actionTaken) {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: ctx.tenantId,
        action: `agent.action.${result.actionType}`,
        entity_type: 'conversation',
        entity_id: ctx.conversationId,
        details: { intent: ctx.intent, customer_phone: ctx.customerPhone, ...result.details },
      });
    }
    return result;
  } catch (err) {
    console.error(`Action ${ctx.intent} failed:`, err);
    return { actionTaken: false };
  }
}

// ═══ APPOINTMENT: CREATE ═══
async function handleNewAppointment(ctx: ActionContext): Promise<ActionResult> {
  const today = new Date().toISOString().split('T')[0];
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extract appointment details from this message. Return ONLY JSON: {"date":"YYYY-MM-DD","time":"HH:MM","service":"service name or null","staff":"staff name or null"}. If info is missing, return {"unclear":true,"missing":["date","time","service"]}. Today is ${today}. Interpret "mañana" as tomorrow, "lunes" as next Monday, etc.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  });

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(extraction.text); } catch { return { actionTaken: false }; }

  if (parsed.unclear) {
    const missing = (parsed.missing as string[]) || [];
    const qs: string[] = [];
    if (missing.includes('date')) qs.push('¿Qué día le gustaría?');
    if (missing.includes('time')) qs.push('¿A qué hora?');
    if (missing.includes('service')) qs.push('¿Qué servicio necesita?');
    return { actionTaken: true, actionType: 'appointment.clarify', followUpMessage: qs.join(' ') };
  }

  const { data: staff } = await supabaseAdmin.from('staff').select('id, name, google_calendar_id, default_duration').eq('tenant_id', ctx.tenantId).eq('active', true).limit(1);
  const staffMember = staff?.[0];

  const { data: services } = await supabaseAdmin.from('services').select('id, name, duration_minutes, price').eq('tenant_id', ctx.tenantId).eq('active', true);
  const svcName = (parsed.service as string) || '';
  const matchedService = services?.find(s => s.name.toLowerCase().includes(svcName.toLowerCase())) || services?.[0];

  const datetime = `${parsed.date}T${parsed.time}:00`;
  const duration = matchedService?.duration_minutes || staffMember?.default_duration || 30;
  const endDt = new Date(new Date(datetime).getTime() + duration * 60000).toISOString();

  const { data: appointment, error } = await supabaseAdmin.from('appointments').insert({
    tenant_id: ctx.tenantId, staff_id: staffMember?.id, service_id: matchedService?.id,
    contact_id: ctx.contactId, conversation_id: ctx.conversationId,
    customer_phone: ctx.customerPhone, customer_name: ctx.customerName,
    datetime, end_datetime: endDt, duration_minutes: duration, status: 'scheduled', source: 'chat',
  }).select().single();

  if (error || !appointment) return { actionTaken: false };

  // Google Calendar sync
  let calSynced = false;
  if (staffMember?.google_calendar_id) {
    try {
      const { createCalendarEvent } = await import('@/lib/calendar/google');
      const ev = await createCalendarEvent({
        calendarId: staffMember.google_calendar_id,
        summary: `${matchedService?.name || 'Cita'} - ${ctx.customerName}`,
        description: `Agendada por WhatsApp AI\nTel: ${ctx.customerPhone}`,
        startTime: datetime, endTime: endDt, attendeeEmail: undefined,
      });
      if (ev?.eventId) {
        await supabaseAdmin.from('appointments').update({ google_event_id: ev.eventId }).eq('id', appointment.id);
        calSynced = true;
      }
    } catch { /* best effort */ }
  }

  await supabaseAdmin.from('contacts').update({ last_contact_at: new Date().toISOString() }).eq('id', ctx.contactId);

  // Trigger marketplace event
  try {
    const { executeEventAgents } = await import('@/lib/marketplace/engine');
    await executeEventAgents('appointment.completed', { tenant_id: ctx.tenantId, customer_phone: ctx.customerPhone, customer_name: ctx.customerName, service_name: matchedService?.name });
  } catch { /* best effort */ }

  const dateFmt = new Date(datetime).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeFmt = new Date(datetime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return {
    actionTaken: true, actionType: 'appointment.created',
    details: { appointmentId: appointment.id, datetime, calSynced },
    followUpMessage: `✅ ¡Cita agendada!\n\n📅 ${dateFmt}\n🕐 ${timeFmt}${matchedService ? `\n💼 ${matchedService.name}${matchedService.price ? ` - $${matchedService.price} MXN` : ''}` : ''}${staffMember ? `\n👨‍⚕️ ${staffMember.name}` : ''}\n\nLe enviaremos un recordatorio 24h antes. ¿Necesita algo más?`,
  };
}

// ═══ APPOINTMENT: MODIFY ═══
async function handleModifyAppointment(ctx: ActionContext): Promise<ActionResult> {
  const { data: apt } = await supabaseAdmin.from('appointments').select('id, datetime').eq('tenant_id', ctx.tenantId).eq('customer_phone', ctx.customerPhone).in('status', ['scheduled', 'confirmed']).order('datetime', { ascending: true }).limit(1).single();
  if (!apt) return { actionTaken: true, actionType: 'appointment.not_found', followUpMessage: 'No encontré una cita próxima. ¿Desea agendar una nueva?' };
  const d = new Date(apt.datetime).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return { actionTaken: true, actionType: 'appointment.modify_prompt', followUpMessage: `Su cita actual es el ${d}.\n\n¿Para qué fecha y hora le gustaría cambiarla?` };
}

// ═══ APPOINTMENT: CANCEL ═══
async function handleCancelAppointment(ctx: ActionContext): Promise<ActionResult> {
  const { data: apt } = await supabaseAdmin.from('appointments').select('id, datetime, google_event_id').eq('tenant_id', ctx.tenantId).eq('customer_phone', ctx.customerPhone).in('status', ['scheduled', 'confirmed']).order('datetime', { ascending: true }).limit(1).single();
  if (!apt) return { actionTaken: true, actionType: 'appointment.not_found', followUpMessage: 'No encontré una cita próxima a su nombre.' };

  await supabaseAdmin.from('appointments').update({ status: 'cancelled' }).eq('id', apt.id);
  if (apt.google_event_id) { try { const { cancelCalendarEvent } = await import('@/lib/calendar/google'); await cancelCalendarEvent('primary', apt.google_event_id); } catch { /* ok */ } }
  try { const { executeEventAgents } = await import('@/lib/marketplace/engine'); await executeEventAgents('appointment.cancelled', { tenant_id: ctx.tenantId, appointment_id: apt.id }); } catch { /* ok */ }

  const d = new Date(apt.datetime).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return { actionTaken: true, actionType: 'appointment.cancelled', details: { appointmentId: apt.id }, followUpMessage: `✅ Su cita del ${d} ha sido cancelada.\n\n¿Le gustaría reagendar para otra fecha?` };
}

// ═══ ORDER: CREATE ═══
async function handleNewOrder(ctx: ActionContext): Promise<ActionResult> {
  const extraction = await generateResponse({
    model: MODELS.STANDARD,
    system: 'Extract order items. Return ONLY JSON: {"items":[{"name":"item","qty":1,"notes":""}],"delivery":true,"address":"if mentioned"}. If unclear, return {"unclear":true}.',
    messages: [{ role: 'user', content: ctx.content }], temperature: 0.1,
  });
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(extraction.text); } catch { return { actionTaken: false }; }
  if (parsed.unclear) return { actionTaken: false };

  const items = parsed.items as Array<{ name: string; qty: number; notes?: string }>;
  if (!items?.length) return { actionTaken: false };

  const { data: menu } = await supabaseAdmin.from('services').select('name, price').eq('tenant_id', ctx.tenantId).eq('active', true);
  const priced = items.map(i => {
    const match = menu?.find(m => m.name.toLowerCase().includes(i.name.toLowerCase()));
    return { name: i.name, qty: i.qty || 1, price: match?.price || 0, notes: i.notes || '' };
  });

  const subtotal = priced.reduce((s, i) => s + Number(i.price) * i.qty, 0);
  const deliveryFee = parsed.delivery ? 30 : 0;
  const total = subtotal + deliveryFee;

  const { data: order } = await supabaseAdmin.from('orders').insert({
    tenant_id: ctx.tenantId, conversation_id: ctx.conversationId, contact_id: ctx.contactId,
    customer_phone: ctx.customerPhone, customer_name: ctx.customerName,
    items: priced, subtotal, delivery_fee: deliveryFee, total,
    order_type: parsed.delivery ? 'delivery' : 'pickup',
    delivery_address: (parsed.address as string) || '', status: 'pending',
  }).select().single();

  if (!order) return { actionTaken: false };
  const list = priced.map(i => `  • ${i.qty}x ${i.name}${i.price ? ` - $${Number(i.price) * i.qty}` : ''}`).join('\n');
  return {
    actionTaken: true, actionType: 'order.created', details: { orderId: order.id, total },
    followUpMessage: `🧾 ¡Pedido registrado!\n\n${list}\n\nSubtotal: $${subtotal}${parsed.delivery ? `\nEnvío: $${deliveryFee}` : ''}\nTotal: $${total} MXN\n\n${parsed.delivery ? '🛵 Tiempo estimado: 30-45 min' : '🏪 Listo en 15-20 min'}`,
  };
}

// ═══ ORDER: STATUS ═══
async function handleOrderStatus(ctx: ActionContext): Promise<ActionResult> {
  const { data: order } = await supabaseAdmin.from('orders').select('id, status, total, estimated_time_min').eq('tenant_id', ctx.tenantId).eq('customer_phone', ctx.customerPhone).order('created_at', { ascending: false }).limit(1).single();
  if (!order) return { actionTaken: true, actionType: 'order.not_found', followUpMessage: 'No encontré un pedido reciente. ¿Desea hacer un nuevo pedido?' };
  const st: Record<string, string> = { pending: '⏳ Pendiente', confirmed: '✅ Confirmado', preparing: '👨‍🍳 En preparación', ready: '🔔 Listo', en_route: '🛵 En camino', delivered: '✅ Entregado', cancelled: '❌ Cancelado' };
  return { actionTaken: true, actionType: 'order.status', followUpMessage: `📦 Estado: ${st[order.status] || order.status}\nTotal: $${order.total} MXN${order.estimated_time_min ? `\n⏱️ ~${order.estimated_time_min} min` : ''}` };
}

// ═══ RESERVATION (hotels/restaurants) ═══
async function handleReservation(ctx: ActionContext): Promise<ActionResult> {
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extract reservation: {"date":"YYYY-MM-DD","time":"HH:MM","guests":2,"name":"guest"}. Return {"unclear":true} if missing. Today is ${new Date().toISOString().split('T')[0]}.`,
    messages: [{ role: 'user', content: ctx.content }], temperature: 0.1,
  });
  let p: Record<string, unknown>;
  try { p = JSON.parse(extraction.text); } catch { return { actionTaken: false }; }
  if (p.unclear) return { actionTaken: true, actionType: 'reservation.clarify', followUpMessage: '¿Para cuántas personas, qué día y a qué hora?' };

  await supabaseAdmin.from('appointments').insert({
    tenant_id: ctx.tenantId, contact_id: ctx.contactId, conversation_id: ctx.conversationId,
    customer_phone: ctx.customerPhone, customer_name: (p.name as string) || ctx.customerName,
    datetime: `${p.date}T${p.time}:00`, duration_minutes: 120, status: 'scheduled', source: 'chat',
    notes: `Reservación para ${p.guests} personas`,
  });
  const d = new Date(`${p.date}T${p.time}`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return { actionTaken: true, actionType: 'reservation.created', followUpMessage: `🍽️ ¡Reservación confirmada!\n\n📅 ${d}\n🕐 ${p.time}\n👥 ${p.guests} personas\n\nLe esperamos.` };
}

// ═══ COMPLAINT → Auto-escalate ═══
async function handleComplaint(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['complaint', 'urgent'] }).eq('id', ctx.conversationId);
  await supabaseAdmin.from('contacts').update({ lead_temperature: 'hot', tags: ['complaint'] }).eq('id', ctx.contactId);
  return { actionTaken: true, actionType: 'complaint.escalated', followUpMessage: 'Lamento mucho la situación. He comunicado su caso a nuestro equipo y alguien le contactará en los próximos minutos para resolverlo personalmente.' };
}

// ═══ EMERGENCY → Immediate escalation ═══
async function handleEmergency(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['emergency', 'urgent'] }).eq('id', ctx.conversationId);
  const isHealth = ['dental', 'medical', 'veterinary', 'psychologist', 'pediatrician', 'gynecologist', 'ophthalmologist', 'dermatologist', 'nutritionist'].includes(ctx.businessType);
  const name = ctx.tenant.name as string;
  const addr = ctx.tenant.address as string | undefined;
  const phone = ctx.tenant.phone as string | undefined;
  return {
    actionTaken: true, actionType: 'emergency.escalated',
    followUpMessage: isHealth
      ? `🚨 Entiendo que es urgente. ${ctx.businessType === 'veterinary' ? 'Traiga a su mascota' : 'Acuda'} directamente a ${name}${addr ? ` en ${addr}` : ''}.${phone ? ` Llame al ${phone}.` : ''} Si es emergencia médica: 911.`
      : 'He notificado a nuestro equipo de su situación urgente. Alguien le contactará en breve.',
  };
}

// ═══ HUMAN → Transfer to staff ═══
async function handleHumanRequest(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'human_handoff' }).eq('id', ctx.conversationId);
  return { actionTaken: true, actionType: 'human.handoff', followUpMessage: 'Con mucho gusto le comunico con nuestro equipo. En unos momentos le atenderán.' };
}

// ═══ CRISIS → Life-saving protocol ═══
async function handleCrisis(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['crisis', 'urgent'] }).eq('id', ctx.conversationId);
  return {
    actionTaken: true, actionType: 'crisis.detected',
    followUpMessage: 'Entiendo que estás pasando por un momento muy difícil. Tu vida importa.\n\n📞 Línea de la Vida: 800 911 2000 (24/7)\n📞 SAPTEL: 55 5259 8121\n🚨 Emergencias: 911\n\nHe notificado a nuestro equipo para contactarte. No estás solo/a.',
  };
}
