// ═════════════════════════════════════════════════════════════════════════════
// TOOL: book_appointment
//
// Agenda una cita en la base de datos. Reusa toda la lógica defensiva de
// `appointment-helpers.ts` que ya validamos en commit 421e00d:
//   - Conflict check (no double-booking del mismo staff)
//   - Timezone correcto (ISO con offset según tenant.timezone)
//   - Business hours validation
//   - Staff matching por nombre (no random)
//   - Service matching exact-first
//   - Google Calendar sync (best effort)
//
// Diseño del retorno: estructura clara de éxito/error con error_code para que
// el LLM compose un mensaje amable apropiado en cada caso.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildLocalIso,
  hasConflict,
  isWithinBusinessHours,
  findMatchingStaff,
  findMatchingService,
  formatDateTimeMx,
  type StaffRow,
  type ServiceRow,
} from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const argsSchema = z
  .object({
    /** ISO date YYYY-MM-DD interpretada en la zona horaria del tenant. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
    /** ISO time HH:MM (24h) interpretada en la zona horaria del tenant. */
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time debe ser HH:MM (24h)'),
    /** Nombre del servicio que el cliente solicita (será matched fuzzy). */
    service: z.string().min(1).max(120),
    /** Opcional: nombre del staff/doctor preferido. */
    staff: z.string().min(1).max(120).optional(),
    /** Opcional: notas para el equipo (alergias, motivo, etc.). */
    notes: z.string().max(500).optional(),
  })
  .strict();

type BookErrorCode =
  | 'INVALID_ARGS'
  | 'NO_STAFF'
  | 'STAFF_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'OUTSIDE_HOURS'
  | 'CONFLICT'
  | 'INSERT_FAILED';

interface BookSuccessResult {
  success: true;
  appointment: {
    id: string;
    datetime_iso: string;
    date_human: string;
    time_human: string;
    service: string;
    staff: string;
    duration_minutes: number;
    price?: number | string | null;
    calendar_synced: boolean;
  };
}

interface BookErrorResult {
  success: false;
  error_code: BookErrorCode;
  message: string;
  /** Sugerencia útil para que el LLM continúe la conversación. */
  next_step?: string;
}

type BookResult = BookSuccessResult | BookErrorResult;

async function handler(rawArgs: unknown, ctx: ToolContext): Promise<BookResult> {
  // ── Validación de args ──
  const parsed = argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      success: false,
      error_code: 'INVALID_ARGS',
      message: `Argumentos inválidos: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      next_step: 'Pide al cliente que confirme día, hora y servicio en una sola frase clara.',
    };
  }
  const args = parsed.data;
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

  // ── Cargar staff activo ──
  const { data: staffRows } = await supabaseAdmin
    .from('staff')
    .select('id, name, google_calendar_id, default_duration')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  if (!staffRows || staffRows.length === 0) {
    return {
      success: false,
      error_code: 'NO_STAFF',
      message: 'El consultorio no tiene profesionales activos para agendar en línea en este momento.',
      next_step: 'Ofrece comunicar al cliente con el equipo humano (puedes llamar escalate_to_human).',
    };
  }

  const staffMember = findMatchingStaff(staffRows as StaffRow[], args.staff);
  if (!staffMember) {
    return {
      success: false,
      error_code: 'STAFF_NOT_FOUND',
      message: `No encontré al profesional "${args.staff}". Profesionales disponibles: ${staffRows.map((s) => s.name).join(', ')}.`,
      next_step:
        'Pide al cliente que elija uno de los profesionales listados, o pregunta si prefiere que asignes a alguien disponible.',
    };
  }

  // ── Cargar servicios y matchear ──
  const { data: serviceRows } = await supabaseAdmin
    .from('services')
    .select('id, name, duration_minutes, price')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  const matchedService = findMatchingService(
    (serviceRows || []) as ServiceRow[],
    args.service,
  );
  if (!matchedService) {
    const sample = (serviceRows || []).slice(0, 5).map((s) => s.name).join(', ');
    return {
      success: false,
      error_code: 'SERVICE_NOT_FOUND',
      message: `No encontré "${args.service}" en el catálogo.`,
      next_step: sample
        ? `Pide al cliente que elija un servicio de la lista. Algunos disponibles: ${sample}. O llama get_services para ver el catálogo completo.`
        : 'Llama get_services primero para conocer el catálogo y luego propónle opciones al cliente.',
    };
  }

  const duration = matchedService.duration_minutes || staffMember.default_duration || 30;
  const datetime = buildLocalIso(args.date, args.time, timezone);
  const endDt = new Date(new Date(datetime).getTime() + duration * 60_000).toISOString();

  // ── Validar horario laboral ──
  const businessHours = ctx.tenant.business_hours as Record<string, string> | null;
  if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
    return {
      success: false,
      error_code: 'OUTSIDE_HOURS',
      message: `${args.date} ${args.time} está fuera del horario de atención.`,
      next_step:
        'Pide al cliente otra fecha y hora dentro del horario del negocio. Puedes llamar get_business_info para mostrarle el horario.',
    };
  }

  // ── Conflict check ──
  const conflict = await hasConflict({
    tenantId: ctx.tenantId,
    staffId: staffMember.id,
    datetime,
    durationMinutes: duration,
  });
  if (conflict) {
    return {
      success: false,
      error_code: 'CONFLICT',
      message: `${staffMember.name} ya tiene una cita en ese horario.`,
      next_step:
        'Pide al cliente otra hora el mismo día u otra fecha. Si insiste, ofrece comunicarlo con el equipo humano.',
    };
  }

  // ── INSERT ──
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      tenant_id: ctx.tenantId,
      staff_id: staffMember.id,
      service_id: matchedService.id,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId,
      customer_phone: ctx.customerPhone,
      customer_name: (ctx.tenant.name as string) || null, // placeholder; processor passes real name
      datetime,
      end_datetime: endDt,
      duration_minutes: duration,
      status: 'scheduled',
      source: 'orchestrator',
      notes: args.notes || null,
    })
    .select('id')
    .single();

  if (error || !appointment) {
    return {
      success: false,
      error_code: 'INSERT_FAILED',
      message: 'No pude registrar la cita en el sistema.',
      next_step:
        'Avisa al cliente que tuviste un problema técnico, que ya notificaste al equipo y que lo van a contactar.',
    };
  }

  // ── Google Calendar sync (best effort, no bloquea éxito) ──
  let calendar_synced = false;
  if (staffMember.google_calendar_id) {
    try {
      const { createCalendarEvent } = await import('@/lib/calendar/google');
      const ev = await createCalendarEvent({
        calendarId: staffMember.google_calendar_id,
        summary: `${matchedService.name} - vía atiende.ai`,
        description: `Tel: ${ctx.customerPhone}${args.notes ? `\nNotas: ${args.notes}` : ''}`,
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

  // ── Marketplace events (smart-followup, etc.) — best effort ──
  try {
    const { executeEventAgents } = await import('@/lib/marketplace/engine');
    await executeEventAgents('appointment.completed', {
      tenant_id: ctx.tenantId,
      customer_phone: ctx.customerPhone,
      service_name: matchedService.name,
    });
  } catch {
    /* best effort */
  }

  // ── Notify owner ──
  try {
    const { notifyOwner } = await import('@/lib/actions/notifications');
    await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'new_appointment',
      details: `Cliente: ${ctx.customerPhone}\n${matchedService.name} con ${staffMember.name}\n${args.date} ${args.time}`,
    });
  } catch {
    /* best effort */
  }

  const { dateFmt, timeFmt } = formatDateTimeMx(datetime, timezone);

  return {
    success: true,
    appointment: {
      id: appointment.id,
      datetime_iso: datetime,
      date_human: dateFmt,
      time_human: timeFmt,
      service: matchedService.name,
      staff: staffMember.name,
      duration_minutes: duration,
      price: matchedService.price,
      calendar_synced,
    },
  };
}

registerTool('book_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Agenda una cita real en la base de datos. Valida horario laboral, conflictos con el staff, y existencia del servicio. Si retorna success=false, lee error_code + next_step para decidir qué decirle al cliente. NUNCA confirmes una cita al cliente sin haber recibido success=true de esta tool.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Fecha en formato YYYY-MM-DD interpretada en la zona horaria del negocio. Ejemplo: "2026-04-15".',
          },
          time: {
            type: 'string',
            description: 'Hora en formato HH:MM (24h). Ejemplo: "14:30" para 2:30pm.',
          },
          service: {
            type: 'string',
            description: 'Nombre del servicio que el cliente quiere. Si no estás seguro del catálogo exacto, llama get_services primero.',
          },
          staff: {
            type: 'string',
            description: 'Opcional: nombre del profesional/doctor que el cliente prefiere.',
          },
          notes: {
            type: 'string',
            description: 'Opcional: notas relevantes para el equipo (alergias, motivo de consulta, primera vez, etc.).',
          },
        },
        required: ['date', 'time', 'service'],
        additionalProperties: false,
      },
    },
  },
  handler,
});
