import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import {
  buildLocalIso,
  isWithinBusinessHours,
  hasConflict,
  findMatchingStaff,
  findMatchingService,
  formatDateTimeMx,
  type StaffRow,
  type ServiceRow,
} from '@/lib/actions/appointment-helpers';

// ═══════════════════════════════════════════════════════════
// AGENTIC ACTION ENGINE v1.0.0 — Bots que HACEN, no solo HABLAN
// 21 intent handlers | 100% coverage | Real DB writes + API calls
// Architecture: Single-file for colocation (all handlers share types)
// Related: industry-actions.ts (18 industries), state-machine.ts (multi-turn)
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
    // Core actions (10 original)
    APPOINTMENT_NEW: handleNewAppointment,
    APPOINTMENT_MODIFY: handleModifyAppointment,
    APPOINTMENT_MODIFY_CONFIRM: handleModifyConfirm,
    APPOINTMENT_CANCEL: handleCancelAppointment,
    ORDER_NEW: handleNewOrder,
    ORDER_STATUS: handleOrderStatus,
    RESERVATION: handleReservation,
    COMPLAINT: handleComplaint,
    EMERGENCY: handleEmergency,
    HUMAN: handleHumanRequest,
    CRISIS: handleCrisis,
    // NEW: 10 agentic handlers for remaining intents
    PRICE: handlePrice,
    HOURS: handleHours,
    LOCATION: handleLocation,
    SERVICES_INFO: handleServicesInfo,
    FAQ: handleFAQ,
    REVIEW: handleReview,
    MEDICAL_QUESTION: handleMedicalQuestion,
    LEGAL_QUESTION: handleLegalQuestion,
    SPAM: handleSpam,
    THANKS: handleThanks,
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
//
// Bug fixes applied vs. v1:
//  A. Conflict check — rejects double-booking (same staff, overlapping window)
//  B. Staff selection — matches requested name instead of always returning staff[0]
//  C. Timezone — uses tenant.timezone to build ISO with correct offset (not naive UTC)
//  D. Business hours — rejects bookings outside the day's open window
//  E. Service match — prefers exact match over substring, avoids wrong service
//  F. Surface errors — parse/validation failures send a clear message to the user
//  G. Calendar sync — logs when sync fails and reflects it in the confirmation message
//  H. No staff — returns a graceful error instead of inserting an orphan row
//  I. State context — persists already-captured fields across turns
async function handleNewAppointment(ctx: ActionContext): Promise<ActionResult> {
  const today = new Date().toISOString().split('T')[0];
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

  // (I) Load any partial booking data from previous turns
  const { getConversationState, setConversationState, clearConversationState } = await import(
    '@/lib/actions/state-machine'
  );
  const prevState = await getConversationState(ctx.conversationId);
  const prevCtx = prevState.context as {
    date?: string; time?: string; service?: string; staff?: string;
  } | undefined;

  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extract appointment details from this message. Return ONLY JSON: {"date":"YYYY-MM-DD","time":"HH:MM","service":"service name or null","staff":"staff name or null"}. If info is missing, return {"unclear":true,"missing":["date","time","service"]}. Today is ${today}. Interpret "mañana" as tomorrow, "lunes" as next Monday, etc.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extraction.text);
  } catch {
    // (F) Surface parse failure — the old code silently returned actionTaken:false
    return {
      actionTaken: true,
      actionType: 'appointment.parse_failed',
      followUpMessage:
        'Disculpe, no entendí bien los detalles de su cita. ¿Podría decirme de nuevo el día, la hora y el servicio que necesita?',
    };
  }

  // (I) Merge partial state with whatever the user just said
  const merged = {
    date: (parsed.date as string) || prevCtx?.date,
    time: (parsed.time as string) || prevCtx?.time,
    service: (parsed.service as string) || prevCtx?.service,
    staff: (parsed.staff as string) || prevCtx?.staff,
  };

  // Determine what's still missing
  const missing: string[] = [];
  if (!merged.date) missing.push('date');
  if (!merged.time) missing.push('time');
  // We only consider service "missing" if the business actually has a catalog
  // and the user hasn't picked one. We check that lazily below.

  if (parsed.unclear || missing.length > 0) {
    const qs: string[] = [];
    if (missing.includes('date')) qs.push('¿Qué día le gustaría?');
    if (missing.includes('time')) qs.push('¿A qué hora?');
    if (!missing.length && parsed.unclear) {
      const origMissing = (parsed.missing as string[]) || [];
      if (origMissing.includes('service')) qs.push('¿Qué servicio necesita?');
    }
    // (I) Persist what we captured so far
    await setConversationState(ctx.conversationId, 'awaiting_appointment_date', merged);
    return {
      actionTaken: true,
      actionType: 'appointment.clarify',
      followUpMessage: qs.join(' ') || '¿Me confirma el día y la hora de la cita?',
    };
  }

  // Load staff + services
  const { data: staff } = await supabaseAdmin
    .from('staff')
    .select('id, name, google_calendar_id, default_duration')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  // (H) Graceful error when no staff configured
  if (!staff || staff.length === 0) {
    await clearConversationState(ctx.conversationId);
    return {
      actionTaken: true,
      actionType: 'appointment.no_staff',
      followUpMessage:
        'Disculpe, en este momento no puedo agendar citas en línea. Le voy a comunicar con nuestro equipo para atenderle personalmente.',
    };
  }

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, name, duration_minutes, price')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  // (B) Match staff by requested name
  const staffMember = findMatchingStaff(staff as StaffRow[], merged.staff);
  if (!staffMember) {
    await clearConversationState(ctx.conversationId);
    return {
      actionTaken: true,
      actionType: 'appointment.no_staff',
      followUpMessage:
        'No encontré al profesional que mencionó. ¿Con quién le gustaría agendar, o prefiere que yo asigne a alguien disponible?',
    };
  }

  // (E) Match service with exact-first strategy
  const matchedService = findMatchingService(services as ServiceRow[], merged.service);
  const duration =
    matchedService?.duration_minutes || staffMember.default_duration || 30;

  // (C) Timezone-aware ISO timestamp
  const datetime = buildLocalIso(merged.date!, merged.time!, timezone);
  const endDt = new Date(new Date(datetime).getTime() + duration * 60000).toISOString();

  // (D) Business hours check
  const businessHours = ctx.tenant.business_hours as Record<string, string> | null;
  if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
    // Keep captured state so the user can just say a new time
    await setConversationState(ctx.conversationId, 'awaiting_appointment_date', {
      ...merged, date: undefined, time: undefined,
    });
    return {
      actionTaken: true,
      actionType: 'appointment.outside_hours',
      followUpMessage:
        'Esa hora está fuera de nuestro horario de atención. ¿Podría proponerme otra fecha y hora dentro del horario del negocio?',
    };
  }

  // (A) Pre-check de conflicto: barato, mejora la UX cuando hay conflicto
  // claro, pero NO es la fuente de verdad — el RPC atómico de abajo es la
  // única defensa real contra race conditions (dos webhooks paralelos
  // pasando este check al mismo tiempo y luego insertando ambos).
  const conflict = await hasConflict({
    tenantId: ctx.tenantId,
    staffId: staffMember.id,
    datetime,
    durationMinutes: duration,
  });
  if (conflict) {
    await setConversationState(ctx.conversationId, 'awaiting_appointment_date', {
      ...merged, time: undefined,
    });
    return {
      actionTaken: true,
      actionType: 'appointment.conflict',
      followUpMessage: `Esa hora ya no está disponible con ${staffMember.name}. ¿Le propongo otra hora el mismo día u otra fecha?`,
    };
  }

  // INSERT directo. La atomicidad real la provee el EXCLUDE constraint
  // `appointments_no_overlap` definido en schema.sql: dos INSERTs paralelos
  // para el mismo staff_id+rango temporal hacen que el segundo falle con
  // SQLSTATE 23P01 (exclusion_violation). Sin RPC wrapper para mantener
  // la lógica de error visible aquí y los mocks de tests simples.
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      tenant_id: ctx.tenantId,
      staff_id: staffMember.id,
      service_id: matchedService?.id,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId,
      customer_phone: ctx.customerPhone,
      customer_name: ctx.customerName,
      datetime,
      end_datetime: endDt,
      duration_minutes: duration,
      status: 'scheduled',
      source: 'chat',
    })
    .select()
    .single();

  if (error || !appointment) {
    // SQLSTATE 23P01 = exclusion_violation = nuestro EXCLUDE constraint
    // disparó por overlap concurrente. supabase-js expone el código en
    // `error.code`. Distinguimos para mostrar mensaje de conflicto en lugar
    // de error genérico.
    const isConflict =
      error?.code === '23P01' ||
      /exclusion|appointments_no_overlap|overlap/i.test(error?.message ?? '');
    if (isConflict) {
      await setConversationState(ctx.conversationId, 'awaiting_appointment_date', {
        ...merged, time: undefined,
      });
      return {
        actionTaken: true,
        actionType: 'appointment.conflict',
        followUpMessage: `Esa hora ya no está disponible con ${staffMember.name}. ¿Le propongo otra hora el mismo día u otra fecha?`,
      };
    }
    console.warn('[appointment] insert failed:', error);
    await clearConversationState(ctx.conversationId);
    return {
      actionTaken: true,
      actionType: 'appointment.insert_failed',
      followUpMessage:
        'Tuve un problema registrando su cita. Ya notifiqué al equipo para que le contacten y confirmen.',
    };
  }

  // Booking succeeded — clear state
  await clearConversationState(ctx.conversationId);

  // (G) Google Calendar sync — best-effort en banda. Si falla, marcamos
  // `calendar_sync_status = 'pending'` y el cron `/api/cron/calendar-reconcile`
  // (cada 5min) reintenta hasta 5 veces con backoff exponencial. Esto
  // garantiza que la cita NUNCA queda sin sincronizar silenciosamente.
  let calSynced = false;
  let calSyncFailed = false;
  if (!staffMember.google_calendar_id) {
    // Staff sin calendar conectado → no hay nada que sincronizar
    await supabaseAdmin
      .from('appointments')
      .update({ calendar_sync_status: 'skip' })
      .eq('id', appointment.id);
  } else {
    let syncError: unknown = null;
    try {
      const { createCalendarEvent } = await import('@/lib/calendar/google');
      const ev = await createCalendarEvent({
        staffId: staffMember.id,
        calendarId: staffMember.google_calendar_id,
        summary: `${matchedService?.name || 'Cita'} - ${ctx.customerName}`,
        description: `Agendada por WhatsApp AI\nTel: ${ctx.customerPhone}`,
        startTime: datetime,
        endTime: endDt,
        attendeeEmail: undefined,
      });
      if (ev?.eventId) {
        await supabaseAdmin
          .from('appointments')
          .update({
            google_event_id: ev.eventId,
            calendar_sync_status: 'synced',
            calendar_sync_attempts: 1,
          })
          .eq('id', appointment.id);
        calSynced = true;
      } else {
        calSyncFailed = true;
        syncError = new Error('createCalendarEvent returned no eventId');
      }
    } catch (err) {
      calSyncFailed = true;
      syncError = err;
      console.warn('[appointment] Google Calendar sync failed:', err);
    }
    if (calSyncFailed) {
      // Marca la cita como pendiente para que el cron la reintente.
      // Primer reintento en 60s; el cron aplica backoff progresivo.
      const errMsg =
        syncError instanceof Error ? syncError.message.slice(0, 500) : 'sync failed';
      await supabaseAdmin
        .from('appointments')
        .update({
          calendar_sync_status: 'pending',
          calendar_sync_attempts: 1,
          calendar_sync_last_error: errMsg,
          calendar_sync_next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('id', appointment.id);
    }
  }

  await supabaseAdmin
    .from('contacts')
    .update({ last_contact_at: new Date().toISOString() })
    .eq('id', ctx.contactId);

  // Trigger marketplace event
  try {
    const { executeEventAgents } = await import('@/lib/marketplace/engine');
    await executeEventAgents('appointment.completed', {
      tenant_id: ctx.tenantId,
      customer_phone: ctx.customerPhone,
      customer_name: ctx.customerName,
      service_name: matchedService?.name,
    });
  } catch {
    /* best effort */
  }

  const { dateFmt, timeFmt } = formatDateTimeMx(datetime, timezone);
  const syncNote = calSyncFailed
    ? '\n\n⚠️ Nota: no pude sincronizar con el calendario del profesional. Confirmaremos por aquí.'
    : '';

  return {
    actionTaken: true,
    actionType: 'appointment.created',
    details: { appointmentId: appointment.id, datetime, calSynced, calSyncFailed },
    followUpMessage:
      `✅ ¡Cita agendada!\n\n📅 ${dateFmt}\n🕐 ${timeFmt}` +
      `${matchedService ? `\n💼 ${matchedService.name}${matchedService.price ? ` - $${matchedService.price} MXN` : ''}` : ''}` +
      `\n👨‍⚕️ ${staffMember.name}` +
      `${syncNote}` +
      `\n\nLe enviaremos un recordatorio 24h antes. ¿Necesita algo más?`,
  };
}

// ═══ APPOINTMENT: MODIFY ═══
async function handleModifyAppointment(ctx: ActionContext): Promise<ActionResult> {
  const { data: apt } = await supabaseAdmin.from('appointments').select('id, datetime').eq('tenant_id', ctx.tenantId).eq('customer_phone', ctx.customerPhone).in('status', ['scheduled', 'confirmed']).order('datetime', { ascending: true }).limit(1).single();
  if (!apt) return { actionTaken: true, actionType: 'appointment.not_found', followUpMessage: 'No encontré una cita próxima. ¿Desea agendar una nueva?' };
  // Bug fix: usar formatDateTimeMx (timezone-aware) en vez de toLocaleDateString
  // sin timeZone option. En Vercel el host TZ es UTC, así que 10:00 Mérida
  // (16:00 UTC) salía como "16:00" — confundía al paciente y rompía la UX.
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';
  const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
  // Set state for multi-turn modify flow
  const { setConversationState } = await import('@/lib/actions/state-machine');
  await setConversationState(ctx.conversationId, 'awaiting_modify_date');
  return { actionTaken: true, actionType: 'appointment.modify_prompt', followUpMessage: `Su cita actual es el ${dateFmt} a las ${timeFmt}.\n\n¿Para qué fecha y hora le gustaría cambiarla?` };
}

// ═══ APPOINTMENT: MODIFY CONFIRM (receives new date/time) ═══
//
// Same bug fixes as handleNewAppointment: timezone-aware datetime, business
// hours validation, conflict check against OTHER appointments (not itself),
// and clear error messages instead of silent failures.
async function handleModifyConfirm(ctx: ActionContext): Promise<ActionResult> {
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extract date and time from this message. Return ONLY JSON: {"date":"YYYY-MM-DD","time":"HH:MM"}. Today is ${new Date().toISOString().split('T')[0]}. Interpret "mañana" as tomorrow, "martes" as next Tuesday, etc.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extraction.text);
  } catch {
    // (F) Surface parse failure
    return {
      actionTaken: true,
      actionType: 'appointment.modify_parse_failed',
      followUpMessage:
        'No entendí bien la nueva fecha. ¿Podría decirme día y hora de nuevo? Por ejemplo: "martes 10am".',
    };
  }
  if (!parsed.date || !parsed.time) {
    return {
      actionTaken: true,
      actionType: 'appointment.modify_incomplete',
      followUpMessage: 'Necesito el día y la hora para reagendar. ¿Me los puede dar?',
    };
  }

  // Find the customer's upcoming appointment
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, staff_id, google_event_id, duration_minutes, staff:staff_id(google_calendar_id)')
    .eq('tenant_id', ctx.tenantId)
    .eq('customer_phone', ctx.customerPhone)
    .in('status', ['scheduled', 'confirmed'])
    .order('datetime', { ascending: true })
    .limit(1)
    .single<{
      id: string;
      staff_id: string;
      google_event_id: string | null;
      duration_minutes: number | null;
      staff: { google_calendar_id: string | null } | { google_calendar_id: string | null }[] | null;
    }>();

  if (!apt) {
    return {
      actionTaken: true,
      actionType: 'appointment.not_found',
      followUpMessage: 'No encontré una cita para modificar.',
    };
  }

  const duration = apt.duration_minutes || 30;
  // (C) Timezone-aware
  const newDatetime = buildLocalIso(parsed.date as string, parsed.time as string, timezone);
  const newEnd = new Date(new Date(newDatetime).getTime() + duration * 60000).toISOString();

  // (D) Business hours check
  const businessHours = ctx.tenant.business_hours as Record<string, string> | null;
  if (!isWithinBusinessHours(newDatetime, businessHours, timezone)) {
    return {
      actionTaken: true,
      actionType: 'appointment.modify_outside_hours',
      followUpMessage:
        'Esa hora está fuera del horario de atención. ¿Podría proponerme otra dentro del horario?',
    };
  }

  // Update directo. El EXCLUDE constraint de schema.sql también valida
  // overlaps en UPDATEs — una cita reagendada que choca con otra activa
  // del mismo staff dispara SQLSTATE 23P01. PG aplica la restricción
  // contra el estado nuevo de la fila, por lo que el row no choca consigo
  // mismo (su rango anterior ya no existe en el momento del check).
  const { error } = await supabaseAdmin.from('appointments').update({
    datetime: newDatetime,
    end_datetime: newEnd,
    status: 'scheduled',
  }).eq('id', apt.id);

  if (error) {
    const isConflict =
      error.code === '23P01' ||
      /exclusion|appointments_no_overlap|overlap/i.test(error.message ?? '');
    if (isConflict) {
      return {
        actionTaken: true,
        actionType: 'appointment.modify_conflict',
        followUpMessage:
          'Esa hora ya está ocupada. ¿Le propongo otra hora el mismo día u otra fecha?',
      };
    }
    console.warn('[appointment.modify] update failed:', error);
    return {
      actionTaken: true,
      actionType: 'appointment.modify_failed',
      followUpMessage: 'No pude reagendar la cita. Le comunico con el equipo.',
    };
  }

  // (G) Google Calendar — patch existing event in place (preserves event id and attendees).
  // Si falla, marcamos sync_status=pending y el cron retry hace el patch después.
  const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
  const calendarId = staffRel?.google_calendar_id;
  let calSyncFailed = false;
  if (apt.google_event_id && calendarId) {
    let syncError: unknown = null;
    try {
      const { updateCalendarEvent } = await import('@/lib/calendar/google');
      await updateCalendarEvent({
        staffId: apt.staff_id,
        calendarId,
        eventId: apt.google_event_id,
        startTime: newDatetime,
        endTime: newEnd,
        timezone,
      });
      await supabaseAdmin
        .from('appointments')
        .update({ calendar_sync_status: 'synced' })
        .eq('id', apt.id);
    } catch (err) {
      calSyncFailed = true;
      syncError = err;
      console.warn('[appointment.modify] Google Calendar update failed:', err);
    }
    if (calSyncFailed) {
      const errMsg =
        syncError instanceof Error ? syncError.message.slice(0, 500) : 'sync failed';
      await supabaseAdmin
        .from('appointments')
        .update({
          calendar_sync_status: 'pending',
          calendar_sync_last_error: errMsg,
          calendar_sync_next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('id', apt.id);
    }
  }

  const { dateFmt, timeFmt } = formatDateTimeMx(newDatetime, timezone);
  const syncNote = calSyncFailed
    ? '\n\n⚠️ Nota: no pude actualizar el calendario. Confirmaremos por aquí.'
    : '';

  return {
    actionTaken: true,
    actionType: 'appointment.modified',
    details: { appointmentId: apt.id, newDatetime, calSyncFailed },
    followUpMessage: `✅ ¡Cita reagendada!\n\n📅 ${dateFmt}\n🕐 ${timeFmt}${syncNote}\n\nLe enviaremos un recordatorio. ¿Necesita algo más?`,
  };
}

// ═══ APPOINTMENT: CANCEL ═══
async function handleCancelAppointment(ctx: ActionContext): Promise<ActionResult> {
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, datetime, google_event_id, staff_id, staff:staff_id(google_calendar_id)')
    .eq('tenant_id', ctx.tenantId)
    .eq('customer_phone', ctx.customerPhone)
    .in('status', ['scheduled', 'confirmed'])
    .order('datetime', { ascending: true })
    .limit(1)
    .single<{
      id: string;
      datetime: string;
      google_event_id: string | null;
      staff_id: string;
      staff: { google_calendar_id: string | null } | { google_calendar_id: string | null }[] | null;
    }>();
  if (!apt) return { actionTaken: true, actionType: 'appointment.not_found', followUpMessage: 'No encontré una cita próxima a su nombre.' };

  await supabaseAdmin.from('appointments').update({ status: 'cancelled' }).eq('id', apt.id);
  if (apt.google_event_id) {
    const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
    const calendarId = staffRel?.google_calendar_id;
    if (calendarId) {
      try {
        const { cancelCalendarEvent } = await import('@/lib/calendar/google');
        await cancelCalendarEvent(calendarId, apt.google_event_id, apt.staff_id);
        await supabaseAdmin
          .from('appointments')
          .update({ calendar_sync_status: 'synced' })
          .eq('id', apt.id);
      } catch (err) {
        // Marcamos para que el cron borre el evento remoto después.
        // No bloquea al cliente: la cita ya está cancelada en DB.
        const errMsg =
          err instanceof Error ? err.message.slice(0, 500) : 'cancel sync failed';
        console.warn('[appointment.cancel] Google Calendar delete failed:', err);
        await supabaseAdmin
          .from('appointments')
          .update({
            calendar_sync_status: 'cancel',
            calendar_sync_last_error: errMsg,
            calendar_sync_next_retry_at: new Date(Date.now() + 60_000).toISOString(),
          })
          .eq('id', apt.id);
      }
    }
  }
  try { const { executeEventAgents } = await import('@/lib/marketplace/engine'); await executeEventAgents('appointment.cancelled', { tenant_id: ctx.tenantId, appointment_id: apt.id }); } catch { /* ok */ }

  // Bug fix: timezone-aware formatting via formatDateTimeMx. Vercel host TZ
  // es UTC, sin timeZone option daba la fecha en UTC y citas late-night
  // mexicanas se mostraban como el día siguiente.
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';
  const { dateFmt } = formatDateTimeMx(apt.datetime as string, timezone);
  return { actionTaken: true, actionType: 'appointment.cancelled', details: { appointmentId: apt.id }, followUpMessage: `✅ Su cita del ${dateFmt} ha sido cancelada.\n\n¿Le gustaría reagendar para otra fecha?` };
}

// ═══ ORDER: CREATE ═══
//
// Bug fixes applied vs v1 (matching the same rigor as handleNewAppointment):
//  - Parse failure is surfaced to the user (never silent)
//  - Unknown item names are REJECTED instead of priced at $0 (was: menu
//    fuzzy-match returning `price: 0` when no match, so a customer could
//    "order" non-existent items for free)
//  - Exact-first service match (avoids "tacos" grabbing "tacos de cerdo"
//    when "tacos de asada" was meant)
//  - Delivery fee read from `tenant.config.delivery_fee` (was hardcoded $30)
//  - Business hours validation at order time (rejects 3am pickup orders)
//  - INSERT failures surfaced to the user with a clear message
//  - All failure paths log via console.warn so operators can debug
async function handleNewOrder(ctx: ActionContext): Promise<ActionResult> {
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';
  const tenantConfig = (ctx.tenant.config as Record<string, unknown>) || {};
  const deliveryFeeFromConfig = Number(tenantConfig.delivery_fee);
  const configuredDeliveryFee = Number.isFinite(deliveryFeeFromConfig) && deliveryFeeFromConfig >= 0
    ? deliveryFeeFromConfig
    : 30; // sensible default if tenant hasn't configured it yet

  const extraction = await generateResponse({
    model: MODELS.STANDARD,
    system: 'Extract order items. Return ONLY JSON: {"items":[{"name":"item","qty":1,"notes":""}],"delivery":true,"address":"if mentioned"}. If unclear, return {"unclear":true}.',
    messages: [{ role: 'user', content: ctx.content }], temperature: 0.1,
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extraction.text);
  } catch (err) {
    console.warn('[order] JSON parse failed', err);
    return {
      actionTaken: true,
      actionType: 'order.parse_failed',
      followUpMessage:
        'No entendí bien tu pedido. ¿Podrías escribirme qué te gustaría ordenar, cuánto de cada cosa, y si es para llevar o envío?',
    };
  }
  if (parsed.unclear) {
    return {
      actionTaken: true,
      actionType: 'order.unclear',
      followUpMessage:
        'Necesito un poco más de detalle. ¿Qué te gustaría ordenar y cuánto de cada cosa?',
    };
  }

  const items = parsed.items as Array<{ name: string; qty: number; notes?: string }> | undefined;
  if (!items?.length) {
    return {
      actionTaken: true,
      actionType: 'order.no_items',
      followUpMessage: '¿Qué te gustaría ordenar? Dime los platillos y las cantidades.',
    };
  }

  // Business hours check — prevents 3am pickup orders.
  // For orders we check "now" (not a future datetime) because the customer
  // wants to order right now.
  const businessHours = ctx.tenant.business_hours as Record<string, string> | null;
  const nowIso = new Date().toISOString();
  if (!isWithinBusinessHours(nowIso, businessHours, timezone)) {
    return {
      actionTaken: true,
      actionType: 'order.outside_hours',
      followUpMessage:
        'Lamentablemente estamos fuera de horario en este momento. ¿Te gustaría que anote tu pedido para mañana al abrir?',
    };
  }

  const { data: menu, error: menuErr } = await supabaseAdmin
    .from('services')
    .select('id, name, price, duration_minutes')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);
  if (menuErr) {
    console.warn('[order] failed to load menu', menuErr);
    return {
      actionTaken: true,
      actionType: 'order.menu_failed',
      followUpMessage:
        'Tuve un problema cargando nuestro menú. Ya avisé al equipo para atenderte directamente.',
    };
  }

  // Match each requested item against the menu (exact-first strategy).
  // Items that can't be matched are collected into `unknownItems` so we can
  // tell the customer exactly what wasn't found — instead of silently charging
  // them $0 for a non-existent item.
  const priced: Array<{ name: string; qty: number; price: number; notes: string }> = [];
  const unknownItems: string[] = [];
  for (const i of items) {
    const requested = (i.name || '').trim();
    if (!requested) continue;
    const match = findMatchingService(menu as ServiceRow[], requested);
    if (!match) {
      unknownItems.push(requested);
      continue;
    }
    priced.push({
      name: match.name,
      qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
      price: Number(match.price) || 0,
      notes: i.notes || '',
    });
  }

  if (unknownItems.length > 0) {
    // Don't insert a half-valid order with $0 items — ask the customer to
    // correct the names against our real catalog.
    const sampleMenu = (menu || [])
      .slice(0, 8)
      .map((m) => `• ${m.name}`)
      .join('\n');
    return {
      actionTaken: true,
      actionType: 'order.unknown_items',
      details: { unknownItems },
      followUpMessage:
        `No encontré estos items en nuestro menú: ${unknownItems.join(', ')}.\n\n` +
        `Algunos de los que sí tenemos:\n${sampleMenu}\n\n` +
        `¿Me los pides usando los nombres del menú?`,
    };
  }

  if (priced.length === 0) {
    return {
      actionTaken: true,
      actionType: 'order.no_valid_items',
      followUpMessage: '¿Me confirmas qué te gustaría ordenar del menú?',
    };
  }

  const subtotal = priced.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = parsed.delivery ? configuredDeliveryFee : 0;
  const total = subtotal + deliveryFee;

  const { data: order, error: insertErr } = await supabaseAdmin
    .from('orders')
    .insert({
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      contact_id: ctx.contactId,
      customer_phone: ctx.customerPhone,
      customer_name: ctx.customerName,
      items: priced,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      order_type: parsed.delivery ? 'delivery' : 'pickup',
      delivery_address: (parsed.address as string) || '',
      status: 'pending',
    })
    .select()
    .single();

  if (insertErr || !order) {
    console.warn('[order] insert failed', insertErr);
    return {
      actionTaken: true,
      actionType: 'order.insert_failed',
      followUpMessage:
        'Tuve un problema registrando tu pedido. Ya notifiqué al equipo para que te contacten y lo confirmen manualmente.',
    };
  }

  const list = priced
    .map((i) => `  • ${i.qty}x ${i.name}${i.price ? ` - $${i.price * i.qty}` : ''}`)
    .join('\n');
  return {
    actionTaken: true,
    actionType: 'order.created',
    details: { orderId: order.id, total, deliveryFee },
    followUpMessage:
      `🧾 ¡Pedido registrado!\n\n${list}\n\n` +
      `Subtotal: $${subtotal}${parsed.delivery ? `\nEnvío: $${deliveryFee}` : ''}\n` +
      `Total: $${total} MXN\n\n` +
      `${parsed.delivery ? '🛵 Tiempo estimado: 30-45 min' : '🏪 Listo en 15-20 min'}`,
  };
}

// ═══ ORDER: STATUS ═══
//
// Previously returned the customer's MOST RECENT order regardless of which
// one they asked about. A customer with 3 pending orders asking "¿cómo va
// mi pedido de tacos?" might get back the status of their pizza.
//
// Now:
//   - If there are 0 recent orders in progress → tell the customer
//   - If there's exactly 1 → give its status (same as before)
//   - If there are 2+ in progress → list all of them briefly, so the
//     customer can tell us which one they mean next turn
const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳ Pendiente',
  confirmed: '✅ Confirmado',
  preparing: '👨‍🍳 En preparación',
  ready: '🔔 Listo',
  en_route: '🛵 En camino',
  delivered: '✅ Entregado',
  cancelled: '❌ Cancelado',
};

async function handleOrderStatus(ctx: ActionContext): Promise<ActionResult> {
  // Fetch up to 5 recent non-terminal orders from this customer
  const IN_PROGRESS = ['pending', 'confirmed', 'preparing', 'ready', 'en_route'];
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, status, total, estimated_time_min, items, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('customer_phone', ctx.customerPhone)
    .in('status', IN_PROGRESS)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.warn('[order-status] query failed', error);
    return {
      actionTaken: true,
      actionType: 'order.status_failed',
      followUpMessage: 'Tuve un problema consultando tu pedido. Ya avisé al equipo.',
    };
  }

  if (!orders || orders.length === 0) {
    return {
      actionTaken: true,
      actionType: 'order.not_found',
      followUpMessage: 'No encontré un pedido reciente en curso. ¿Deseas hacer un nuevo pedido?',
    };
  }

  // Single-order case: unchanged behavior.
  if (orders.length === 1) {
    const order = orders[0];
    return {
      actionTaken: true,
      actionType: 'order.status',
      details: { orderId: order.id },
      followUpMessage:
        `📦 Estado: ${STATUS_EMOJI[order.status] || order.status}\n` +
        `Total: $${order.total} MXN` +
        (order.estimated_time_min ? `\n⏱️ ~${order.estimated_time_min} min` : ''),
    };
  }

  // Multiple orders in progress → list them so the customer can clarify.
  const summary = orders
    .map((o) => {
      const firstItem = Array.isArray(o.items) && o.items[0]
        ? (o.items[0] as { name?: string }).name || 'pedido'
        : 'pedido';
      const extraCount = Array.isArray(o.items) && o.items.length > 1
        ? ` (+${o.items.length - 1} más)`
        : '';
      return `• ${firstItem}${extraCount} — ${STATUS_EMOJI[o.status] || o.status} — $${o.total}`;
    })
    .join('\n');

  return {
    actionTaken: true,
    actionType: 'order.status_multi',
    details: { orderCount: orders.length },
    followUpMessage:
      `Tienes ${orders.length} pedidos en curso:\n\n${summary}\n\n` +
      `¿Sobre cuál quieres saber más?`,
  };
}

// ═══ RESERVATION (hotels/restaurants) ═══
//
// Same bug fixes: timezone, business hours, surfaces parse failures.
// Reservations don't require a specific staff member, so the conflict check
// is skipped (capacity management would need a different strategy: table
// count, room inventory, etc.).
async function handleReservation(ctx: ActionContext): Promise<ActionResult> {
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extract reservation: {"date":"YYYY-MM-DD","time":"HH:MM","guests":2,"name":"guest"}. Return {"unclear":true} if missing. Today is ${new Date().toISOString().split('T')[0]}.`,
    messages: [{ role: 'user', content: ctx.content }], temperature: 0.1,
  });
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(extraction.text);
  } catch {
    // (F) Surface parse failure
    return {
      actionTaken: true,
      actionType: 'reservation.parse_failed',
      followUpMessage:
        'No entendí los detalles de la reservación. ¿Me puede decir día, hora y para cuántas personas?',
    };
  }
  if (p.unclear) {
    const { setConversationState } = await import('@/lib/actions/state-machine');
    await setConversationState(ctx.conversationId, 'awaiting_reservation_details');
    return { actionTaken: true, actionType: 'reservation.clarify', followUpMessage: '¿Para cuántas personas, qué día y a qué hora?' };
  }

  // (C) Timezone-aware
  const datetime = buildLocalIso(p.date as string, p.time as string, timezone);
  const duration = 120;
  const endDt = new Date(new Date(datetime).getTime() + duration * 60000).toISOString();

  // (D) Business hours check
  const businessHours = ctx.tenant.business_hours as Record<string, string> | null;
  if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
    return {
      actionTaken: true,
      actionType: 'reservation.outside_hours',
      followUpMessage:
        'Esa hora está fuera de nuestro horario. ¿Podría proponerme otra dentro del horario del negocio?',
    };
  }

  const { error } = await supabaseAdmin.from('appointments').insert({
    tenant_id: ctx.tenantId, contact_id: ctx.contactId, conversation_id: ctx.conversationId,
    customer_phone: ctx.customerPhone, customer_name: (p.name as string) || ctx.customerName,
    datetime, end_datetime: endDt, duration_minutes: duration, status: 'scheduled', source: 'chat',
    notes: `Reservación para ${p.guests} personas`,
  });

  if (error) {
    return {
      actionTaken: true,
      actionType: 'reservation.insert_failed',
      followUpMessage:
        'Tuve un problema registrando la reservación. Ya avisé al equipo para que le contacten.',
    };
  }

  const { dateFmt, timeFmt } = formatDateTimeMx(datetime, timezone);
  return {
    actionTaken: true,
    actionType: 'reservation.created',
    followUpMessage: `🍽️ ¡Reservación confirmada!\n\n📅 ${dateFmt}\n🕐 ${timeFmt}\n👥 ${p.guests} personas\n\nLe esperamos.`,
  };
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

// ═══════════════════════════════════════════════════════════
// 10 NEW AGENTIC HANDLERS — 100% intent coverage
// ═══════════════════════════════════════════════════════════

// ═══ PRICE → Query REAL prices from DB ═══
async function handlePrice(ctx: ActionContext): Promise<ActionResult> {
  const { data: services } = await supabaseAdmin.from('services').select('name, price, description, category').eq('tenant_id', ctx.tenantId).eq('active', true).order('category');
  if (!services?.length) return { actionTaken: false };

  const grouped = new Map<string, typeof services>();
  for (const s of services) {
    const cat = s.category || 'General';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(s);
  }

  let msg = '💰 Nuestros precios:\n';
  for (const [cat, items] of grouped) {
    msg += `\n*${cat}*\n`;
    for (const s of items) {
      msg += `• ${s.name}${s.price ? ` — $${s.price} MXN` : ''}\n`;
    }
  }
  msg = msg.slice(0, 580) + '\n\n¿Le gustaría agendar algún servicio?';

  await updateContact(ctx, ['price_inquiry']);
  return { actionTaken: true, actionType: 'price.lookup', details: { count: services.length }, followUpMessage: msg };
}

// ═══ HOURS → Check REAL business hours + open/closed status ═══
async function handleHours(ctx: ActionContext): Promise<ActionResult> {
  const hours = ctx.tenant.business_hours as Record<string, string> | null;
  if (!hours) return { actionTaken: false };

  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const now = new Date();
  const today = days[now.getDay()];
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayHours = hours[today];

  let isOpen = false;
  if (todayHours && todayHours !== 'cerrado') {
    const [open, close] = todayHours.split('-');
    isOpen = currentTime >= open && currentTime <= close;
  }

  let msg = isOpen ? '🟢 Estamos ABIERTOS\n\n' : '🔴 Estamos CERRADOS\n\n';
  msg += '📅 Horarios:\n';
  for (let i = 1; i <= 6; i++) {
    const d = days[i % 7 === 0 ? 0 : i];
    msg += `• ${dayNames[i % 7 === 0 ? 0 : i]}: ${hours[d] || 'Cerrado'}\n`;
  }
  if (hours.dom) msg += `• Domingo: ${hours.dom}\n`;

  if (!isOpen) {
    const tomorrow = days[(now.getDay() + 1) % 7];
    const tomorrowHours = hours[tomorrow];
    if (tomorrowHours && tomorrowHours !== 'cerrado') {
      msg += `\nAbrimos mañana a las ${tomorrowHours.split('-')[0]}`;
    }
  }

  await updateContact(ctx, ['hours_inquiry']);
  return { actionTaken: true, actionType: 'hours.lookup', followUpMessage: msg };
}

// ═══ LOCATION → Send pin + update CRM ═══
async function handleLocation(ctx: ActionContext): Promise<ActionResult> {
  await updateContact(ctx, ['location_inquiry']);
  const addr = ctx.tenant.address as string | undefined;
  if (!addr) return { actionTaken: false };
  return {
    actionTaken: true, actionType: 'location.sent',
    followUpMessage: `📍 Nos encontramos en:\n${addr}\n${ctx.tenant.city || ''}, ${ctx.tenant.state || ''}\n\n¿Necesita indicaciones para llegar?`,
  };
}

// ═══ SERVICES_INFO → Full catalog from DB ═══
async function handleServicesInfo(ctx: ActionContext): Promise<ActionResult> {
  const { data: services } = await supabaseAdmin.from('services').select('name, price, duration_minutes, description').eq('tenant_id', ctx.tenantId).eq('active', true);
  if (!services?.length) return { actionTaken: false };

  let msg = `📋 Servicios de ${ctx.tenant.name}:\n\n`;
  for (const s of services.slice(0, 10)) {
    msg += `• *${s.name}*${s.price ? ` — $${s.price} MXN` : ''}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}\n`;
    if (s.description) msg += `  ${s.description.slice(0, 60)}\n`;
  }
  if (services.length > 10) msg += `\n...y ${services.length - 10} servicios más.`;
  msg += '\n\n¿Le gustaría agendar alguno?';

  await updateContact(ctx, ['services_inquiry']);
  return { actionTaken: true, actionType: 'services.catalog', details: { count: services.length }, followUpMessage: msg };
}

// ═══ FAQ → Structured KB search with attribution ═══
async function handleFAQ(ctx: ActionContext): Promise<ActionResult> {
  // FAQ is already handled by RAG in step 10 of processor
  // Here we just update CRM for tracking
  await updateContact(ctx, ['faq_inquiry']);
  return { actionTaken: false }; // Let RAG handle the response
}

// ═══ REVIEW → Send Google review link ═══
async function handleReview(ctx: ActionContext): Promise<ActionResult> {
  const placeId = ctx.tenant.google_place_id as string | undefined;
  const url = placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : null;

  await updateContact(ctx, ['review_interest', 'positive_sentiment']);

  return {
    actionTaken: true, actionType: 'review.link_sent',
    followUpMessage: url
      ? `¡Nos encantaría conocer su opinión! 🙏\n\nDeje su reseña aquí:\n${url}\n\n¡Muchas gracias por su preferencia!`
      : '¡Muchas gracias por su interés en dejarnos una reseña! Puede encontrarnos en Google Maps buscando "' + (ctx.tenant.name as string) + '". ¡Su opinión nos ayuda mucho!',
  };
}

// ═══ MEDICAL_QUESTION → COMPLIANCE: Escalate immediately ═══
async function handleMedicalQuestion(ctx: ActionContext): Promise<ActionResult> {
  const isHealth = ['dental', 'medical', 'veterinary', 'psychologist', 'pediatrician', 'gynecologist', 'ophthalmologist', 'dermatologist', 'nutritionist'].includes(ctx.businessType);

  if (isHealth) {
    await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['medical_question', 'needs_professional'] }).eq('id', ctx.conversationId);
    await updateContact(ctx, ['medical_question']);
    return {
      actionTaken: true, actionType: 'medical.escalated',
      followUpMessage: 'Esa es una consulta que nuestro profesional de salud debe atender personalmente. He notificado a nuestro equipo para que le contacten. Para consultas urgentes, no dude en llamarnos o acudir directamente.',
    };
  }
  return { actionTaken: false };
}

// ═══ LEGAL_QUESTION → COMPLIANCE: Escalate ═══
async function handleLegalQuestion(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['legal_question'] }).eq('id', ctx.conversationId);
  await updateContact(ctx, ['legal_question']);
  return {
    actionTaken: true, actionType: 'legal.escalated',
    followUpMessage: 'Las consultas legales requieren atención personalizada de nuestro equipo. He comunicado su caso para que le contacten directamente.',
  };
}

// ═══ SPAM → Auto-archive + protect ═══
async function handleSpam(ctx: ActionContext): Promise<ActionResult> {
  await supabaseAdmin.from('conversations').update({ status: 'archived', tags: ['spam'] }).eq('id', ctx.conversationId);
  await supabaseAdmin.from('contacts').update({ tags: ['spam'] }).eq('id', ctx.contactId);
  return { actionTaken: true, actionType: 'spam.archived' };
  // No follow-up message — don't engage with spam
}

// ═══ THANKS → Positive sentiment capture + upsell opportunity ═══
async function handleThanks(ctx: ActionContext): Promise<ActionResult> {
  await updateContact(ctx, ['positive_sentiment']);
  await supabaseAdmin.from('contacts').update({ lead_temperature: 'hot' }).eq('id', ctx.contactId);

  // Trigger review request and upselling marketplace agents
  try {
    const { executeEventAgents } = await import('@/lib/marketplace/engine');
    await executeEventAgents('review.positive', { tenant_id: ctx.tenantId, customer_phone: ctx.customerPhone, customer_name: ctx.customerName });
  } catch (err) {
    console.warn('[actions] thanks event agents failed:', err instanceof Error ? err.message : err);
  }

  return { actionTaken: true, actionType: 'thanks.captured' };
  // No follow-up — the LLM already said "de nada"
}

// ═══ UTILITY: Update contact CRM record ═══
async function updateContact(ctx: ActionContext, newTags: string[]) {
  try {
    const { data: contact } = await supabaseAdmin.from('contacts').select('tags').eq('id', ctx.contactId).single();
    const existingTags = (contact?.tags as string[]) || [];
    const mergedTags = [...new Set([...existingTags, ...newTags])];
    await supabaseAdmin.from('contacts').update({
      last_contact_at: new Date().toISOString(),
      tags: mergedTags,
    }).eq('id', ctx.contactId);
  } catch (err) {
    console.warn('[actions] updateContact failed:', err instanceof Error ? err.message : err);
  }
}
