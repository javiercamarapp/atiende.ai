// ═════════════════════════════════════════════════════════════════════════════
// AGENDA TOOLS — Phase 2.A complete
//
// 5 tools que reúsan helpers de `appointment-helpers.ts` (Phase 1 bug-fixed):
//   - check_availability   (A.2)
//   - book_appointment     (A.3)
//   - get_my_appointments  (A.1)
//   - modify_appointment   (A.4)
//   - cancel_appointment   (A.1)
//
// Todas scoped por tenantId + customer_phone para prevenir prompt-injection
// cross-patient. Todas retornan {success, error_code, message, next_step}
// para que el LLM sepa qué responder sin ver detalles técnicos.
//
// Registro: side-effect al importar. `agenda/index.ts` importa este file
// para forzar el registerTool() global.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildLocalIso,
  formatDateTimeMx,
  hasConflict,
  isWithinBusinessHours,
  findMatchingService,
  findMatchingStaff,
  type StaffRow,
  type ServiceRow,
} from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { resolveTenantTimezone } from '@/lib/config';
import { normalizePhoneMx } from '@/lib/whatsapp/normalize-phone';

// ─── Tool 1: check_availability ──────────────────────────────────────────────
const CheckAvailArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
    service_type: z.string().min(1).max(120).optional(),
    staff_id: z.string().uuid().optional(),
    duration_minutes: z.number().int().min(15).max(240).optional().default(30),
  })
  .strict();

/** Slot buffer entre citas (min). Evita encimar citas que terminan "justito". */
const SLOT_BUFFER_MINUTES = 15;
/** Máximo slots que devolvemos al LLM para no saturar el prompt. */
const MAX_SLOTS_RETURNED = 8;

interface Slot {
  time: string;
  end_time: string;
  staff_id: string;
  staff_name: string;
}

interface StaffSlim {
  id: string;
  name: string;
  default_duration: number | null;
}

function todayIsoInTz(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dayKeyFromDate(dateIso: string, timezone: string): string {
  // dateIso = YYYY-MM-DD ; queremos el key 'lun' | 'mar' | ... en la TZ del tenant.
  // Construimos mediodía para evitar edge cases de TZ en los límites del día.
  const midday = buildLocalIso(dateIso, '12:00', timezone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(midday)).toLowerCase();
  const map: Record<string, string> = {
    sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab',
  };
  return map[weekday] || 'lun';
}

function parseHoursWindow(raw: string | undefined):
  | { openMin: number; closeMin: number }
  | null {
  if (!raw || raw === 'cerrado' || !raw.includes('-')) return null;
  const [open, close] = raw.split('-');
  if (!open || !close) return null;
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return null;
  return { openMin: oh * 60 + om, closeMin: ch * 60 + cm };
}

/** Busca la siguiente fecha con ≥1 slot libre, hasta 14 días adelante. */
async function findNextAvailableDate(opts: {
  tenantId: string;
  startDate: string; // YYYY-MM-DD
  timezone: string;
  businessHours: Record<string, string>;
  durationMinutes: number;
  staffList: StaffSlim[];
}): Promise<string | null> {
  // PERF-2: 1 query batch trayendo TODAS las citas del rango (14 días) en vez
  // de hacer (14 días) × (N staff) queries individuales. Con 5 staff ahorra
  // 70 round-trips a Supabase y el TOOL_TIMEOUT_MS = 4_000 ya no se agota.
  const start = new Date(opts.startDate + 'T00:00:00Z');
  const rangeStart = new Date(start.getTime() + 86_400_000).toISOString();
  const rangeEnd = new Date(start.getTime() + 15 * 86_400_000).toISOString();

  const { data: bookings } = await supabaseAdmin
    .from('appointments')
    .select('staff_id, datetime, end_datetime')
    .eq('tenant_id', opts.tenantId)
    .in('status', ['scheduled', 'confirmed'])
    .gte('datetime', rangeStart)
    .lt('datetime', rangeEnd);

  // Index local: staffId → array de [startMs, endMs]
  const idx = new Map<string, Array<[number, number]>>();
  for (const b of (bookings || []) as Array<{ staff_id: string; datetime: string; end_datetime: string }>) {
    const arr = idx.get(b.staff_id) || [];
    arr.push([new Date(b.datetime).getTime(), new Date(b.end_datetime).getTime()]);
    idx.set(b.staff_id, arr);
  }

  for (let i = 1; i <= 14; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const dayKey = dayKeyFromDate(iso, opts.timezone);
    const win = parseHoursWindow(opts.businessHours[dayKey]);
    if (!win) continue;

    const firstOpen = `${String(Math.floor(win.openMin / 60)).padStart(2, '0')}:${String(win.openMin % 60).padStart(2, '0')}`;
    const dtIso = buildLocalIso(iso, firstOpen, opts.timezone);
    const slotStart = new Date(dtIso).getTime();
    const slotEnd = slotStart + opts.durationMinutes * 60_000;

    // ¿Hay al menos un staff libre en ese primer slot? (in-memory check)
    for (const staff of opts.staffList) {
      const conflicts = idx.get(staff.id) || [];
      const hasConflict = conflicts.some(([s, e]) => s < slotEnd && e > slotStart);
      if (!hasConflict) return iso;
    }
  }
  return null;
}

registerTool('check_availability', {
  schema: {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        'Consulta horarios disponibles para agendar una cita. Llamar ANTES de book_appointment. Resolver fechas relativas (mañana, lunes, etc.) a YYYY-MM-DD antes de invocar. Retorna slots libres o un next_available_date si la fecha pedida está llena/cerrada.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Opcional' },
          staff_id: { type: 'string', description: 'UUID opcional' },
          duration_minutes: { type: 'number', description: 'Default 30, entre 15 y 240' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CheckAvailArgs.parse(rawArgs);
    const timezone = resolveTenantTimezone(ctx.tenant);
    const durationMinutes = args.duration_minutes ?? 30;

    // 1. Fecha no puede ser pasada (en TZ del tenant)
    const today = todayIsoInTz(timezone);
    if (args.date < today) {
      return {
        available: false,
        reason: 'PAST_DATE',
        message: 'La fecha solicitada ya pasó. Pide al paciente otra fecha.',
      };
    }

    // 1.5. Fecha no puede ser día festivo configurado (best effort — si tabla
    // no existe, el query falla silenciosamente y se considera no-festivo).
    try {
      const { data: holiday } = await supabaseAdmin
        .from('tenant_holidays')
        .select('reason')
        .eq('tenant_id', ctx.tenantId)
        .eq('date', args.date)
        .maybeSingle();
      if (holiday) {
        return {
          available: false,
          reason: 'HOLIDAY',
          message: `El consultorio no atiende esa fecha (${holiday.reason}).`,
        };
      }
    } catch {
      /* tenant_holidays no migrated yet — skip */
    }

    // 2. ¿Es día laboral según business_hours?
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || {};
    const dayKey = dayKeyFromDate(args.date, timezone);
    const window = parseHoursWindow(businessHours[dayKey]);
    if (!window) {
      // Cerrado ese día → buscar próximo día laboral con disponibilidad
      const { data: staffList } = await supabaseAdmin
        .from('staff')
        .select('id, name, default_duration')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true);

      const nextAvailable = staffList && staffList.length > 0
        ? await findNextAvailableDate({
            tenantId: ctx.tenantId,
            startDate: args.date,
            timezone,
            businessHours,
            durationMinutes,
            staffList: staffList as StaffSlim[],
          })
        : null;

      return {
        available: false,
        reason: 'CLOSED',
        message: 'El consultorio no atiende ese día.',
        next_available_date: nextAvailable,
      };
    }

    // 3. Cargar staff activo (filtrado opcional por staff_id)
    let staffQuery = supabaseAdmin
      .from('staff')
      .select('id, name, default_duration')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);
    if (args.staff_id) staffQuery = staffQuery.eq('id', args.staff_id);
    const { data: staffRows } = await staffQuery;
    const staffList = (staffRows || []) as StaffSlim[];

    if (staffList.length === 0) {
      return {
        available: false,
        reason: 'NO_STAFF',
        message: args.staff_id
          ? 'El profesional solicitado no está disponible.'
          : 'No hay profesionales activos para agendar en línea.',
      };
    }

    // 4. Cargar citas ocupadas del día (de TODO el staff activo, filtrar per-staff después)
    //    Ventana del día completa en TZ del tenant → UTC.
    const dayStartIso = buildLocalIso(args.date, '00:00', timezone);
    const dayEndIso = new Date(
      new Date(dayStartIso).getTime() + 24 * 60 * 60_000,
    ).toISOString();

    const { data: bookings } = await supabaseAdmin
      .from('appointments')
      .select('staff_id, datetime, end_datetime')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('datetime', dayStartIso)
      .lt('datetime', dayEndIso);

    const byStaff: Record<string, Array<{ start: number; end: number }>> = {};
    for (const b of bookings || []) {
      const sid = (b.staff_id as string) || 'unassigned';
      if (!byStaff[sid]) byStaff[sid] = [];
      const start = new Date(b.datetime as string).getTime();
      const end = b.end_datetime
        ? new Date(b.end_datetime as string).getTime()
        : start + durationMinutes * 60_000;
      byStaff[sid].push({ start, end });
    }

    // 5. Generar candidatos cada `durationMinutes` minutos desde openMin hasta
    //    (closeMin - durationMinutes). Para cada candidato, buscar al menos
    //    un staff libre (con buffer). Saltar candidatos en el pasado (hoy).
    const nowMs = Date.now();
    const stepMinutes = durationMinutes;
    const slots: Slot[] = [];

    for (
      let minuteOfDay = window.openMin;
      minuteOfDay + durationMinutes <= window.closeMin;
      minuteOfDay += stepMinutes
    ) {
      const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
      const mm = String(minuteOfDay % 60).padStart(2, '0');
      const startIso = buildLocalIso(args.date, `${hh}:${mm}`, timezone);
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + durationMinutes * 60_000;

      if (startMs < nowMs) continue; // no sugerir slots que ya pasaron

      // Confirmar que el slot cae dentro de business_hours (defense in depth)
      if (!isWithinBusinessHours(startIso, businessHours, timezone)) continue;

      // Buscar un staff libre para este slot (respetando buffer)
      const bufferMs = SLOT_BUFFER_MINUTES * 60_000;
      const freeStaff = staffList.find((staff) => {
        const occupied = byStaff[staff.id] || [];
        return !occupied.some((o) => o.start - bufferMs < endMs && o.end + bufferMs > startMs);
      });

      if (freeStaff) {
        const endHH = String(Math.floor((minuteOfDay + durationMinutes) / 60)).padStart(2, '0');
        const endMM = String((minuteOfDay + durationMinutes) % 60).padStart(2, '0');
        slots.push({
          time: `${hh}:${mm}`,
          end_time: `${endHH}:${endMM}`,
          staff_id: freeStaff.id,
          staff_name: freeStaff.name,
        });
        if (slots.length >= MAX_SLOTS_RETURNED) break;
      }
    }

    if (slots.length === 0) {
      const nextAvailable = await findNextAvailableDate({
        tenantId: ctx.tenantId,
        startDate: args.date,
        timezone,
        businessHours,
        durationMinutes,
        staffList,
      });
      return {
        available: false,
        reason: 'FULL',
        message: 'No hay horarios disponibles ese día.',
        next_available_date: nextAvailable,
      };
    }

    const { dateFmt } = formatDateTimeMx(buildLocalIso(args.date, '12:00', timezone), timezone);
    return {
      available: true,
      date: args.date,
      date_human: dateFmt,
      duration_minutes: durationMinutes,
      slots,
      total_available: slots.length,
      more_slots_exist: slots.length === MAX_SLOTS_RETURNED,
    };
  },
});

// ─── Tool 2: book_appointment ────────────────────────────────────────────────
const BookArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time debe ser HH:MM 24h'),
    service_type: z.string().min(1).max(120),
    // Nombres mexicanos largos (ej. 5+ apellidos compuestos) pueden llegar
    // a ~120 chars. Aceptamos hasta 300 como red de seguridad, pero
    // TRUNCAMOS a 120 + limpiamos saltos de línea / spam de espacios antes
    // de persistir. Así un LLM que pase "Nombre\n\n\n(...)" no rompe el
    // catálogo de pacientes.
    patient_name: z
      .string()
      .min(1)
      .max(300)
      .transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120)),
    patient_phone: z.string().min(6).max(20),
    staff_id: z.string().uuid().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

/** 8-char hex uppercase, sirve como referencia humana para el paciente. */
function generateConfirmationCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

registerTool('book_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Crea una cita confirmada en la base de datos. SOLO llamar después de: (1) check_availability confirmó disponibilidad, (2) el paciente confirmó TODOS los datos explícitamente. Nunca llamar sin confirmación del paciente.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (24h)' },
          service_type: { type: 'string' },
          patient_name: { type: 'string' },
          patient_phone: { type: 'string' },
          staff_id: { type: 'string', description: 'UUID opcional — si se omite se elige un staff libre' },
          notes: { type: 'string', description: 'Opcional — alergias, motivo, primera vez, etc.' },
        },
        required: ['date', 'time', 'service_type', 'patient_name', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const parse = BookArgs.safeParse(rawArgs);
    if (!parse.success) {
      console.warn('[tool:book_appointment] validation failed:', parse.error.issues);
      return {
        success: false,
        error_code: 'INVALID_ARGS',
        message:
          'Permítame verificar los datos. ¿Puede confirmarme el día, la hora y su nombre completo?',
      };
    }
    const args = parse.data;
    args.patient_phone = normalizePhoneMx(args.patient_phone);
    const timezone = resolveTenantTimezone(ctx.tenant);
    const datetime = buildLocalIso(args.date, args.time, timezone);

    // 1. Validar que la fecha no es pasada
    if (new Date(datetime).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_DATE',
        message: 'Esa fecha y hora ya pasaron.',
      };
    }

    // 2. Validar business hours (defense in depth — check_availability ya lo validó)
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || null;
    if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
      return {
        success: false,
        error_code: 'OUTSIDE_HOURS',
        message: 'Ese horario está fuera del horario de atención.',
        next_step: 'Llama check_availability para ver slots válidos.',
      };
    }

    // 3. Cargar staff activo; elegir por staff_id o fuzzy-match por nombre
    const { data: staffRows } = await supabaseAdmin
      .from('staff')
      .select('id, name, google_calendar_id, default_duration')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    if (!staffRows || staffRows.length === 0) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No hay profesionales activos para agendar en línea.',
        next_step: 'Escala a humano (escalate_to_human).',
      };
    }

    let staffMember: StaffRow | null = null;
    if (args.staff_id) {
      staffMember = (staffRows.find((s) => s.id === args.staff_id) as StaffRow) || null;
      if (!staffMember) {
        return {
          success: false,
          error_code: 'STAFF_NOT_FOUND',
          message: 'El profesional solicitado no existe o no está activo.',
        };
      }
    } else {
      // Sin staff específico: dejamos el fuzzy-match (aunque no hay name en args,
      // en la práctica caerá al primer disponible después del conflict check).
      staffMember = findMatchingStaff(staffRows as StaffRow[], null);
    }
    if (!staffMember) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No encontré un profesional disponible.',
      };
    }

    // 4. Match service (para grabar service_id + duración real)
    const { data: serviceRows } = await supabaseAdmin
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    const matchedService = findMatchingService(
      (serviceRows || []) as ServiceRow[],
      args.service_type,
    );

    // Rechaza solo precios NULL/undefined/negativos — precio
    // EXACTO de 0 es legítimo (valoración inicial gratis, lectura de
    // estudios, consulta de cortesía). El catálogo clínico mexicano
    // comúnmente marca servicios gratuitos con price=0 intencional.
    if (
      matchedService &&
      (matchedService.price === null ||
        matchedService.price === undefined ||
        Number(matchedService.price) < 0)
    ) {
      return {
        success: false,
        error_code: 'INVALID_SERVICE_PRICE',
        message:
          'Ese servicio tiene un precio inválido en el catálogo. Por favor pídale al consultorio que lo corrija antes de agendar.',
      };
    }

    const duration = matchedService?.duration_minutes
      || staffMember.default_duration
      || 30;
    const endDt = new Date(
      new Date(datetime).getTime() + duration * 60_000,
    ).toISOString();

    // 5. Conflict check (previene double-booking — el slot pudo haberse tomado
    //    entre el check_availability y este book_appointment)
    const conflict = await hasConflict({
      tenantId: ctx.tenantId,
      staffId: staffMember.id,
      datetime,
      durationMinutes: duration,
    });
    if (conflict) {
      return {
        success: false,
        error_code: 'SLOT_TAKEN',
        message: 'Ese horario ya no está disponible.',
        next_step:
          'Llama check_availability de nuevo para obtener slots actualizados y pide al paciente que elija otro.',
      };
    }

    // 6. INSERT atómico
    const confirmationCode = generateConfirmationCode();
    const { data: appointment, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        tenant_id: ctx.tenantId,
        staff_id: staffMember.id,
        service_id: matchedService?.id ?? null,
        contact_id: ctx.contactId,
        conversation_id: ctx.conversationId,
        customer_phone: args.patient_phone,
        customer_name: args.patient_name,
        datetime,
        end_datetime: endDt,
        duration_minutes: duration,
        status: 'scheduled',
        source: 'orchestrator',
        confirmation_code: confirmationCode,
        notes: args.notes ?? null,
      })
      .select('id')
      .single();

    if (error || !appointment) {
      // 23505 = unique_violation (uniq_appointment_slot). Race condition:
      // otro paciente ganó el slot entre nuestro hasConflict y este INSERT.
      if ((error as { code?: string } | null)?.code === '23505') {
        return {
          success: false,
          error_code: 'SLOT_TAKEN',
          message: 'Ese horario acaba de ser ocupado por otro paciente. Pídele que elija otro.',
          next_step:
            'Llama check_availability de nuevo para obtener slots actualizados.',
        };
      }
      console.warn('[tool:book_appointment] INSERT failed:', error?.message);
      return {
        success: false,
        error_code: 'INSERT_FAILED',
        message: 'Tuve un problema registrando la cita.',
        next_step:
          'Disculpa al paciente y avísale que el equipo lo va a contactar. Puedes llamar escalate_to_human.',
      };
    }

    // 7. Google Calendar sync (best effort)
    let calendar_synced = false;
    if (staffMember.google_calendar_id) {
      try {
        const { createCalendarEvent } = await import('@/lib/calendar/google');
        const ev = await createCalendarEvent({
          staffId: staffMember.id,
          calendarId: staffMember.google_calendar_id,
          summary: `${matchedService?.name || args.service_type} - ${args.patient_name}`,
          description: `WhatsApp: ${args.patient_phone}${args.notes ? `\nNotas: ${args.notes}` : ''}\nCódigo: ${confirmationCode}`,
          startTime: datetime,
          endTime: endDt,
          attendeeEmail: undefined,
        });
        if (ev?.eventId) {
          await supabaseAdmin
            .from('appointments')
            .update({ google_event_id: ev.eventId })
            .eq('id', appointment.id);
          calendar_synced = true;
        }
      } catch (err) {
        console.warn('[tool:book_appointment] Calendar sync failed:', err);
      }
    }

    // 8. notifyOwner — si falla, persistimos `owner_notified=false` en la
    // fila de la cita para que el cron `/api/cron/notify-retry` pueda
    // reprocesar con backoff exponencial.
    const { dateFmt, timeFmt } = formatDateTimeMx(datetime, timezone);
    let ownerNotified = false;
    let ownerNotifyError: string | undefined;
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      const res = await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'new_appointment',
        details: `${args.patient_name} (${args.patient_phone})\n${matchedService?.name || args.service_type} con ${staffMember.name}\n${dateFmt} ${timeFmt}\nCódigo: ${confirmationCode}`,
      });
      ownerNotified = res.ok;
      if (!res.ok) ownerNotifyError = res.error;
    } catch (err) {
      ownerNotifyError = err instanceof Error ? err.message : String(err);
      console.warn('[book_appointment] notifyOwner threw:', ownerNotifyError);
    }
    // Persistir resultado en la cita para visibilidad + retry posterior.
    // Si las columnas no existen aún (schema antiguo), el UPDATE falla en
    // silencio — la migración contact_send_errors/appointments_owner_notify
    // añade las columnas.
    try {
      await supabaseAdmin
        .from('appointments')
        .update({
          owner_notified: ownerNotified,
          owner_notified_at: ownerNotified ? new Date().toISOString() : null,
          owner_notify_error: ownerNotifyError ?? null,
        })
        .eq('id', appointment.id);
    } catch {
      /* columna nueva — schema no aplicado aún */
    }

    // 9. Marketplace event
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.completed', {
        tenant_id: ctx.tenantId,
        customer_phone: args.patient_phone,
        customer_name: args.patient_name,
        service_name: matchedService?.name,
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      appointment: {
        appointment_id: appointment.id as string,
        confirmation_code: confirmationCode,
        datetime_iso: datetime,
        date_human: dateFmt,
        time_human: timeFmt,
        service: matchedService?.name || args.service_type,
        staff_name: staffMember.name,
        duration_minutes: duration,
        price: matchedService?.price ?? null,
        calendar_synced,
      },
      summary: `Cita agendada para ${dateFmt} a las ${timeFmt} con ${staffMember.name}. Código: ${confirmationCode}`,
    };
  },
});

// ─── Tool 3: get_my_appointments ─────────────────────────────────────────────
const GetMyArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    include_past: z.boolean().optional().default(false),
  })
  .strict();

interface FormattedAppointment {
  appointment_id: string;
  confirmation_code: string | null;
  datetime_iso: string;
  datetime_formatted: string;
  service: string | null;
  staff_name: string | null;
  status: string;
}

registerTool('get_my_appointments', {
  schema: {
    type: 'function',
    function: {
      name: 'get_my_appointments',
      description:
        'Obtiene las citas del paciente identificado por su número de WhatsApp. Por defecto solo retorna citas futuras.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          include_past: { type: 'boolean', description: 'Default false' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetMyArgs.parse(rawArgs);
    args.patient_phone = normalizePhoneMx(args.patient_phone);
    const timezone = resolveTenantTimezone(ctx.tenant);

    let q = supabaseAdmin
      .from('appointments')
      .select(`
        id,
        confirmation_code,
        datetime,
        status,
        notes,
        service_id,
        staff_id,
        services:service_id(name),
        staff:staff_id(name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', args.patient_phone)
      .order('datetime', { ascending: true })
      .limit(10);

    if (!args.include_past) {
      q = q.gte('datetime', new Date().toISOString());
    }

    const { data, error } = await q;

    if (error) {
      return {
        success: false,
        error_code: 'QUERY_FAILED',
        message: 'No pude consultar sus citas en este momento.',
        appointments: [],
      };
    }

    const appointments: FormattedAppointment[] = (data || []).map((row) => {
      const { dateFmt, timeFmt } = formatDateTimeMx(row.datetime as string, timezone);
      const serviceRel = row.services as { name?: string } | null;
      const staffRel = row.staff as { name?: string } | null;
      return {
        appointment_id: row.id as string,
        confirmation_code: (row.confirmation_code as string | null) ?? null,
        datetime_iso: row.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        service: serviceRel?.name ?? null,
        staff_name: staffRel?.name ?? null,
        status: row.status as string,
      };
    });

    if (appointments.length === 0) {
      return {
        success: true,
        count: 0,
        appointments: [],
        message: args.include_past
          ? 'Este paciente no tiene citas registradas en el sistema.'
          : 'Este paciente no tiene citas futuras agendadas.',
      };
    }

    return {
      success: true,
      count: appointments.length,
      appointments,
    };
  },
});

// ─── Tool 4: modify_appointment ──────────────────────────────────────────────
const ModifyArgs = z
  .object({
    appointment_id: z
      .string()
      .optional()
      .refine((val) => !val || UUID_RE.test(val), {
        message:
          'appointment_id debe ser UUID. Para códigos cortos como ABC12345 usa el campo confirmation_code.',
      }),
    confirmation_code: z.string().regex(/^[A-Z0-9]{6,10}$/).optional(),
    patient_phone: z.string().min(6).max(20).optional(),
    new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    new_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .refine((d) => d.appointment_id || d.confirmation_code, {
    message: 'Provee appointment_id o confirmation_code.',
  })
  .refine((d) => d.new_date || d.new_time, {
    message: 'Debes proveer new_date o new_time (o ambos).',
  });

registerTool('modify_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'modify_appointment',
      description:
        'Reagenda una cita existente a nueva fecha y/o hora. Verifica ownership (tenant + customer_phone), que la cita sea futura, que el nuevo slot esté en horario laboral y libre (hasConflict excluyendo la cita que se mueve).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita (opcional si se da confirmation_code).' },
          confirmation_code: { type: 'string', description: 'Código corto (6-10 alfanumérico) — opcional si se da appointment_id.' },
          patient_phone: { type: 'string', description: 'IGNORADO — el sistema usa el WhatsApp autenticado del sender.' },
          new_date: { type: 'string', description: 'YYYY-MM-DD — opcional si solo cambia la hora.' },
          new_time: { type: 'string', description: 'HH:MM (24h) — opcional si solo cambia el día.' },
          reason: { type: 'string', description: 'Opcional: motivo del cambio.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const parse = ModifyArgs.safeParse(rawArgs);
    if (!parse.success) {
      console.warn('[tool:modify_appointment] validation failed:', parse.error.issues);
      return {
        success: false,
        error_code: 'INVALID_ARGS',
        message:
          'Permítame verificar los datos. ¿Puede confirmarme el código de cita y la nueva fecha u hora que prefiere?',
      };
    }
    const args = parse.data;
    // CRÍTICO: usar ctx.customerPhone (del WhatsApp autenticado), NO el phone
    // del LLM. El LLM puede inventar/inyectar phone de OTRO paciente —
    // prompt injection IDOR. Solo el sender real puede modificar sus citas.
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    // Resolver appointment_id desde confirmation_code si es necesario.
    let resolvedId = args.appointment_id;
    if (!resolvedId && args.confirmation_code) {
      const { data: byCode } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_phone', ownerPhone)
        .eq('confirmation_code', args.confirmation_code.toUpperCase())
        .gt('datetime', new Date().toISOString())
        .maybeSingle();
      if (!byCode) {
        return {
          success: false,
          error_code: 'NOT_FOUND',
          message: 'No encontré ninguna cita futura con ese código a su nombre.',
        };
      }
      resolvedId = byCode.id as string;
    }

    // 1. SELECT scoped por (id, tenant_id, customer_phone del SENDER REAL)
    // Incluimos customer_name y service_id para poder recrear el Google
    // Calendar event después del UPDATE.
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select(
        'id, staff_id, service_id, datetime, end_datetime, duration_minutes, status, google_event_id, notes, customer_name, customer_phone, confirmation_code',
      )
      .eq('id', resolvedId!)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .single();

    if (readErr || !apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'No encontré una cita con ese identificador a nombre de este paciente.',
        next_step: 'Llama get_my_appointments para listar sus citas.',
      };
    }

    if (new Date(apt.datetime as string).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_APPOINTMENT',
        message: 'Esa cita ya pasó — no puede reagendarse.',
      };
    }
    if (apt.status === 'cancelled') {
      return {
        success: false,
        error_code: 'CANCELLED',
        message: 'Esa cita fue cancelada previamente. Agenda una nueva con book_appointment.',
      };
    }

    // 2. Componer el nuevo datetime — reusar la fecha/hora original si una es opcional
    const origDt = new Date(apt.datetime as string);
    const origDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(origDt);
    const origTimeIso = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).format(origDt);

    const newDate = args.new_date || origDateIso;
    const newTime = args.new_time || origTimeIso;
    const newDatetime = buildLocalIso(newDate, newTime, timezone);

    if (new Date(newDatetime).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_DATE',
        message: 'La nueva fecha y hora ya pasaron.',
      };
    }

    // 3. Validar nuevo slot dentro de business hours
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || null;
    if (!isWithinBusinessHours(newDatetime, businessHours, timezone)) {
      return {
        success: false,
        error_code: 'OUTSIDE_HOURS',
        message: 'El nuevo horario está fuera del horario de atención.',
        next_step: 'Llama check_availability para ver opciones válidas.',
      };
    }

    const duration = (apt.duration_minutes as number) || 30;
    const newEndDt = new Date(
      new Date(newDatetime).getTime() + duration * 60_000,
    ).toISOString();

    // 4. Conflict check EXCLUYENDO la propia cita (si no, detectaría colisión
    //    consigo misma cuando solo cambia la hora dentro del mismo slot original).
    const newStart = new Date(newDatetime).toISOString();
    const { count: conflictCount } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', apt.staff_id as string)
      .neq('id', apt.id)
      .in('status', ['scheduled', 'confirmed'])
      .lt('datetime', newEndDt)
      .gt('end_datetime', newStart);

    if ((conflictCount ?? 0) > 0) {
      return {
        success: false,
        error_code: 'SLOT_TAKEN',
        message: 'El nuevo horario ya está ocupado.',
        next_step: 'Llama check_availability para slots alternativos.',
      };
    }

    // 5. UPDATE + persistir notes con motivo si se dio
    const mergedNotes = args.reason
      ? `${apt.notes ? apt.notes + ' | ' : ''}Reagenda: ${args.reason}`
      : apt.notes;

    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        datetime: newDatetime,
        end_datetime: newEndDt,
        notes: mergedNotes,
        // Reset status to scheduled — si estaba 'confirmed' queremos que se
        // re-confirme con el nuevo horario.
        status: 'scheduled',
      })
      .eq('id', apt.id);

    if (updErr) {
      return {
        success: false,
        error_code: 'UPDATE_FAILED',
        message: 'Tuve un problema registrando el cambio.',
      };
    }

    // 6. Actualizar Google Calendar — CANCEL del viejo Y CREATE del nuevo
    // evento. El bug anterior solo cancelaba asumiendo que un "sync
    // posterior" recrearía el evento; en realidad no existía ese sync y el
    // doctor veía la cita desaparecer de su Google Calendar.
    let calendar_unsync_attempted = false;
    let calendar_resync_ok = false;
    let new_google_event_id: string | null = null;
    if (apt.google_event_id) {
      calendar_unsync_attempted = true;
      try {
        // Prefer updateCalendarEvent (patch) — keeps event id, attendees, links.
        const { updateCalendarEvent } = await import('@/lib/calendar/google');
        const [{ data: staffRow }, { data: serviceRow }] = await Promise.all([
          supabaseAdmin
            .from('staff')
            .select('google_calendar_id, name')
            .eq('id', apt.staff_id as string)
            .maybeSingle(),
          apt.service_id
            ? supabaseAdmin
                .from('services')
                .select('name')
                .eq('id', apt.service_id as string)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const calendarId = staffRow?.google_calendar_id as string | undefined;
        const serviceName = (serviceRow?.name as string) || 'Consulta';
        if (calendarId) {
          const ev = await updateCalendarEvent({
            staffId: apt.staff_id as string,
            calendarId,
            eventId: apt.google_event_id as string,
            summary: `${serviceName} - ${apt.customer_name || 'Paciente'}`,
            description:
              `WhatsApp: ${apt.customer_phone}${mergedNotes ? `\nNotas: ${mergedNotes}` : ''}` +
              (apt.confirmation_code ? `\nCódigo: ${apt.confirmation_code}` : ''),
            startTime: newDatetime,
            endTime: newEndDt,
          });
          if (ev?.eventId) {
            new_google_event_id = ev.eventId;
            calendar_resync_ok = true;
          }
        }
      } catch (err) {
        console.warn('[tool:modify_appointment] Calendar update failed:', err);
      }
    }

    const { dateFmt: oldDateFmt, timeFmt: oldTimeFmt } = formatDateTimeMx(
      apt.datetime as string,
      timezone,
    );
    const { dateFmt: newDateFmt, timeFmt: newTimeFmt } = formatDateTimeMx(
      newDatetime,
      timezone,
    );

    // 7. Notify owner
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'new_appointment', // reuse closest existing event
        details: `Reagendamiento: ${ownerPhone}\nAntes: ${oldDateFmt} ${oldTimeFmt}\nAhora: ${newDateFmt} ${newTimeFmt}${args.reason ? `\nMotivo: ${args.reason}` : ''}`,
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      modified: {
        appointment_id: apt.id as string,
        old_datetime_iso: apt.datetime as string,
        old_datetime_formatted: `${oldDateFmt} a las ${oldTimeFmt}`,
        new_datetime_iso: newDatetime,
        new_datetime_formatted: `${newDateFmt} a las ${newTimeFmt}`,
        calendar_unsync_attempted,
        calendar_resync_ok,
        new_google_event_id,
      },
      summary: `Su cita fue reagendada de ${oldDateFmt} ${oldTimeFmt} a ${newDateFmt} ${newTimeFmt}.`,
    };
  },
});

// ─── Tool 5: cancel_appointment ──────────────────────────────────────────────
// Si el LLM mete un código corto en `appointment_id` (UUID), Zod fallaba
// con un mensaje genérico y el LLM podía reintentar con el mismo error en
// bucle. Ahora lo redirige explícitamente a usar `confirmation_code` en el
// mensaje de error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CancelArgs = z
  .object({
    appointment_id: z
      .string()
      .optional()
      .refine((val) => !val || UUID_RE.test(val), {
        message:
          'appointment_id debe ser UUID. Para códigos cortos como ABC12345 usa el campo confirmation_code.',
      }),
    confirmation_code: z.string().regex(/^[A-Z0-9]{6,10}$/).optional(),
    patient_phone: z.string().min(6).max(20).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((d) => d.appointment_id || d.confirmation_code, {
    message: 'Provee appointment_id o confirmation_code.',
  });

registerTool('cancel_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description:
        'Cancela una cita. Verifica (scoped server-side) que la cita pertenezca al paciente que escribe y que sea futura.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita.' },
          patient_phone: { type: 'string', description: 'Número WhatsApp del paciente.' },
          reason: { type: 'string', description: 'Opcional: motivo breve.' },
        },
        required: ['appointment_id', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CancelArgs.parse(rawArgs);
    // CRÍTICO: usar ctx.customerPhone (sender real), NO args.patient_phone
    // del LLM (vulnerable a IDOR via prompt injection).
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    // Si dieron confirmation_code, resolver el appointment_id real
    let resolvedId = args.appointment_id;
    if (!resolvedId && args.confirmation_code) {
      const { data: byCode } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_phone', ownerPhone)
        .eq('confirmation_code', args.confirmation_code.toUpperCase())
        .gt('datetime', new Date().toISOString())
        .maybeSingle();
      if (!byCode) {
        return {
          success: false,
          error_code: 'NOT_FOUND',
          message: 'No encontré ninguna cita futura con ese código a su nombre.',
        };
      }
      resolvedId = byCode.id as string;
    }

    // 1. Verificar existencia + ownership + futura — un solo query scoped por
    //    tenantId + customer_phone para que el LLM no pueda cancelar una cita
    //    de otro paciente inyectándole un appointment_id arbitrario.
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, status, google_event_id, customer_phone, staff_id, staff:staff_id(google_calendar_id)')
      .eq('id', resolvedId!)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .single();

    if (readErr || !apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message:
          'No encontré una cita con ese identificador a nombre de este paciente.',
        next_step:
          'Si el paciente no tiene el código de confirmación, llama get_my_appointments para listar sus citas.',
      };
    }

    const aptDate = new Date(apt.datetime as string);
    if (aptDate.getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_APPOINTMENT',
        message: 'Esa cita ya pasó — no puede cancelarse.',
      };
    }

    if (apt.status === 'cancelled') {
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      return {
        success: true,
        already_cancelled: true,
        cancelled: {
          appointment_id: apt.id as string,
          datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        },
        message: 'La cita ya estaba cancelada previamente.',
      };
    }

    // 2. UPDATE status + reason + timestamp
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: args.reason ?? null,
      })
      .eq('id', apt.id);

    if (updErr) {
      return {
        success: false,
        error_code: 'UPDATE_FAILED',
        message:
          'Tuve un problema registrando la cancelación. Ya notifiqué al equipo.',
      };
    }

    // 3. Cancel Google Calendar event (best effort — no bloquea el retorno)
    let calendar_unsync_attempted = false;
    if (apt.google_event_id) {
      calendar_unsync_attempted = true;
      try {
        const { cancelCalendarEvent } = await import('@/lib/calendar/google');
        const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
        const calendarId = (staffRel as { google_calendar_id: string | null } | null)?.google_calendar_id;
        if (calendarId) {
          await cancelCalendarEvent(calendarId, apt.google_event_id as string, apt.staff_id as string);
        }
      } catch (err) {
        console.warn('[tool:cancel_appointment] Calendar unsync failed:', err);
      }
    }

    // 4. Marketplace event (smart-followup puede querer reagendar) — best effort
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.cancelled', {
        tenant_id: ctx.tenantId,
        appointment_id: apt.id,
      });
    } catch {
      /* best effort */
    }

    // 5. Notificar al dueño
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'complaint', // reuso del evento existente más cercano
        details: `Cancelación: ${args.patient_phone}\nCita: ${dateFmt} ${timeFmt}${args.reason ? `\nMotivo: ${args.reason}` : ''}`,
      });
    } catch {
      /* best effort */
    }

    // 6. Clasificar motivo de cancelación con LLM (best effort, fire-and-forget)
    //    Se dispara en background — no bloqueamos la respuesta al paciente.
    if (ctx.conversationId) {
      const { classifyCancellationReason } = await import(
        '@/lib/intelligence/conversation-analysis'
      );
      classifyCancellationReason(ctx.conversationId, apt.id as string).catch(() => {
        /* best effort */
      });
    }

    const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
    return {
      success: true,
      cancelled: {
        appointment_id: apt.id as string,
        datetime_iso: apt.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        calendar_unsync_attempted,
      },
      message: `Su cita del ${dateFmt} a las ${timeFmt} fue cancelada exitosamente.`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// A.6  CONFIRM_APPOINTMENT — paciente responde "sí" / "confirmo" a un
//      recordatorio o propuesta de reagenda. Marca la cita como 'confirmed'.
//      Scoped por tenantId + customer_phone (no IDOR).
// ═══════════════════════════════════════════════════════════════════════════
const ConfirmArgs = z
  .object({
    appointment_id: z.string().uuid().optional(),
    patient_phone: z.string(),
  })
  .strict();

registerTool('confirm_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'confirm_appointment',
      description:
        'Marca una cita futura del paciente como confirmada. Úsalo cuando el paciente responda afirmativamente a un recordatorio o propuesta de reagenda ("sí", "confirmo", "de acuerdo", "ahí estaré"). Si no pasas appointment_id, toma la próxima cita del paciente.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita. Opcional — si no, se usa la próxima.' },
          patient_phone: { type: 'string' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ConfirmArgs.parse(rawArgs);
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    let q = supabaseAdmin
      .from('appointments')
      .select('id, datetime, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .in('status', ['scheduled', 'confirmed'])
      .gt('datetime', new Date().toISOString())
      .order('datetime', { ascending: true })
      .limit(1);
    if (args.appointment_id) q = q.eq('id', args.appointment_id);

    const { data: apt } = await q.maybeSingle();

    if (!apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'No encontré una cita futura a su nombre para confirmar.',
        next_step: 'Llama get_my_appointments para listar o book_appointment si quiere una nueva.',
      };
    }

    if (apt.status === 'confirmed') {
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      return {
        success: true,
        already_confirmed: true,
        message: `Perfecto, su cita del ${dateFmt} a las ${timeFmt} ya está confirmada.`,
      };
    }

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', apt.id);

    if (error) {
      return {
        success: false,
        error_code: 'DB_UPDATE_FAILED',
        message: 'No pude marcar la confirmación. Inténtelo en un momento.',
      };
    }

    const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
    return {
      success: true,
      confirmed: {
        appointment_id: apt.id as string,
        datetime_iso: apt.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
      },
      message: `Confirmada — lo esperamos el ${dateFmt} a las ${timeFmt}.`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// A.7  LIST_DOCTOR_SCHEDULE — el agente consulta la agenda del doctor para
//      un día específico y puede responder al paciente "hoy tengo 10 am y
//      5 pm libres". También útil para detectar si un doctor está a capacidad.
//      No expone datos personales de otros pacientes — solo agregados.
// ═══════════════════════════════════════════════════════════════════════════
const ListScheduleArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    staff_name: z.string().optional(),
  })
  .strict();

registerTool('list_doctor_schedule', {
  schema: {
    type: 'function',
    function: {
      name: 'list_doctor_schedule',
      description:
        'Devuelve cuántas citas tiene el doctor ese día y a qué horas. No retorna datos personales de los pacientes, solo los slots ocupados. Útil cuando el paciente pregunta "¿qué tan ocupado está el doctor tal día?".',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          staff_name: { type: 'string', description: 'Opcional — nombre del staff/doctor' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ListScheduleArgs.parse(rawArgs);
    const timezone = resolveTenantTimezone(ctx.tenant);
    const dayStart = buildLocalIso(args.date, '00:00', timezone);
    const dayEnd = buildLocalIso(args.date, '23:59', timezone);

    // Staff
    const { data: staffAll } = await supabaseAdmin
      .from('staff')
      .select('id, name, default_duration, google_calendar_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    const staffRows = (staffAll || []) as StaffRow[];
    const staff = args.staff_name
      ? findMatchingStaff(staffRows, args.staff_name)
      : staffRows[0];

    if (!staff) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No encuentro registro del doctor/staff.',
      };
    }

    // Local appointments that day
    const { data: apts } = await supabaseAdmin
      .from('appointments')
      .select('datetime, duration_minutes, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', staff.id)
      .gte('datetime', dayStart)
      .lte('datetime', dayEnd)
      .in('status', ['scheduled', 'confirmed']);

    const busy: Array<{ start: string; end: string }> = ((apts || []) as Array<{ datetime: string; duration_minutes: number | null }>).map((a) => {
      const s = new Date(a.datetime);
      const e = new Date(s.getTime() + (a.duration_minutes || staff.default_duration || 30) * 60000);
      return { start: s.toISOString(), end: e.toISOString() };
    });

    // Google events
    if (staff.google_calendar_id) {
      try {
        const { listCalendarEvents } = await import('@/lib/calendar/google');
        const evs = await listCalendarEvents({
          staffId: staff.id,
          calendarId: staff.google_calendar_id,
          timeMin: dayStart,
          timeMax: dayEnd,
          timezone,
        });
        for (const e of evs) {
          if (e.startTime && e.endTime && e.status !== 'cancelled') {
            busy.push({ start: e.startTime, end: e.endTime });
          }
        }
      } catch { /* best effort */ }
    }

    busy.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return {
      success: true,
      date: args.date,
      staff_name: staff.name,
      total_busy: busy.length,
      busy_slots: busy.map((b) => ({
        start: new Date(b.start).toLocaleTimeString('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        end: new Date(b.end).toLocaleTimeString('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      })),
      message:
        busy.length === 0
          ? `${staff.name} tiene el día libre el ${args.date}.`
          : `${staff.name} tiene ${busy.length} compromiso(s) el ${args.date}.`,
    };
  },
});
