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
import { formatDateTimeMx } from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const NOT_IMPLEMENTED = {
  unimplemented: true,
  message: 'Tool registered (Phase 2 scaffolding) — handler implementation pending in next sub-phase.',
};

// ─── Tool 1: check_availability ──────────────────────────────────────────────
registerTool('check_availability', {
  schema: {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        'Consulta horarios disponibles para agendar una cita. Llamar ANTES de book_appointment. Resolver fechas relativas (mañana, lunes, etc.) a YYYY-MM-DD antes de invocar.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Opcional' },
          staff_id: { type: 'string', description: 'Opcional' },
          duration_minutes: { type: 'number', description: 'Default 30' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
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
