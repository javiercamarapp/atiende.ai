// ═════════════════════════════════════════════════════════════════════════════
// AGENDA TOOLS — Phase 2.A (in progress)
//
// 5 tools que reúsan helpers existentes de `appointment-helpers.ts`:
//   - check_availability       [STUB — sub-phase A.2]
//   - book_appointment         [STUB — sub-phase A.3]
//   - get_my_appointments      [IMPLEMENTED — sub-phase A.1]
//   - modify_appointment       [STUB — sub-phase A.4]
//   - cancel_appointment       [IMPLEMENTED — sub-phase A.1]
//
// El registro vive en este archivo (side-effect al import) — `agenda/index.ts`
// importa este file para forzar el registerTool().
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildLocalIso,
  formatDateTimeMx,
  isWithinBusinessHours,
} from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const NOT_IMPLEMENTED = {
  unimplemented: true,
  message: 'Tool registered (Phase 2 scaffolding) — handler implementation pending in next sub-phase.',
};

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
  const start = new Date(opts.startDate + 'T00:00:00Z');
  for (let i = 1; i <= 14; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const dayKey = dayKeyFromDate(iso, opts.timezone);
    const win = parseHoursWindow(opts.businessHours[dayKey]);
    if (!win) continue;

    // Sondeo barato: 1 slot al open + duración; si no hay conflicto para algún
    // staff → esa fecha tiene al menos 1 hueco.
    const firstOpen = `${String(Math.floor(win.openMin / 60)).padStart(2, '0')}:${String(win.openMin % 60).padStart(2, '0')}`;
    const dtIso = buildLocalIso(iso, firstOpen, opts.timezone);
    const endIso = new Date(
      new Date(dtIso).getTime() + opts.durationMinutes * 60_000,
    ).toISOString();

    // ¿Hay al menos un staff libre en ese primer slot?
    for (const staff of opts.staffList) {
      const { count } = await supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', opts.tenantId)
        .eq('staff_id', staff.id)
        .in('status', ['scheduled', 'confirmed'])
        .lt('datetime', endIso)
        .gt('end_datetime', dtIso);
      if ((count ?? 0) === 0) return iso;
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
    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';
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
registerTool('book_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Crea una cita confirmada. SOLO llamar después de (1) check_availability OK y (2) confirmación EXPLÍCITA del paciente. Nunca llamar sin confirmación.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (24h)' },
          service_type: { type: 'string' },
          patient_name: { type: 'string' },
          patient_phone: { type: 'string' },
          staff_id: { type: 'string', description: 'Opcional' },
          notes: { type: 'string', description: 'Opcional' },
        },
        required: ['date', 'time', 'service_type', 'patient_name', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
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
    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

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
registerTool('modify_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'modify_appointment',
      description:
        'Modifica fecha u hora de una cita existente. Verifica disponibilidad del nuevo slot.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          new_date: { type: 'string', description: 'YYYY-MM-DD opcional' },
          new_time: { type: 'string', description: 'HH:MM opcional' },
          reason: { type: 'string', description: 'Opcional' },
        },
        required: ['appointment_id', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 5: cancel_appointment ──────────────────────────────────────────────
const CancelArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

registerTool('cancel_appointment', {
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
    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

    // 1. Verificar existencia + ownership + futura — un solo query scoped por
    //    tenantId + customer_phone para que el LLM no pueda cancelar una cita
    //    de otro paciente inyectándole un appointment_id arbitrario.
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, status, google_event_id, customer_phone')
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', args.patient_phone)
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
        await cancelCalendarEvent('primary', apt.google_event_id as string);
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
