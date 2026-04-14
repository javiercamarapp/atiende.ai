// ═════════════════════════════════════════════════════════════════════════════
// NO-SHOW TOOLS — Phase 2.B
//
// Worker autónomo que corre via cron a las 6pm (medianoche UTC). Para cada
// tenant con features.tool_calling=true y features.no_show_worker !== false,
// el cron invoca runOrchestrator con este agente y las 5 tools abajo. No
// es conversacional — recibe la lista de citas de mañana y las procesa.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTimeMx } from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const NOT_IMPLEMENTED = {
  unimplemented: true,
  message: 'Tool handler pending next sub-phase.',
};

// ─── Tool 1: get_appointments_tomorrow ───────────────────────────────────────
const GetApptsTomorrowArgs = z
  .object({
    tenant_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
  })
  .strict();

interface PendingAppt {
  appointment_id: string;
  patient_phone: string;
  patient_name: string;
  datetime_iso: string;
  datetime_formatted: string;
  service: string | null;
  staff_name: string | null;
  no_show_risk_score: number;
}

registerTool('get_appointments_tomorrow', {
  schema: {
    type: 'function',
    function: {
      name: 'get_appointments_tomorrow',
      description:
        'Lista las citas del día indicado que aún no han recibido recordatorio de confirmación. Scoped por tenant_id + fecha en zona horaria del tenant. Excluye canceladas y ya recordadas.',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string', description: 'UUID del tenant (debe coincidir con ctx.tenantId).' },
          date: { type: 'string', description: 'YYYY-MM-DD en timezone del tenant.' },
        },
        required: ['tenant_id', 'date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetApptsTomorrowArgs.parse(rawArgs);

    // Seguridad: el tenant_id del arg debe coincidir con el del ctx — el LLM
    // corre como este tenant y no puede tocar datos de otro.
    if (args.tenant_id !== ctx.tenantId) {
      return {
        success: false,
        error_code: 'TENANT_MISMATCH',
        message: 'tenant_id del argumento no coincide con el contexto del worker.',
      };
    }

    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

    // Ventana del día en TZ del tenant → rango UTC
    const startLocal = new Date(`${args.date}T00:00:00`);
    const tzOffsetMs = new Date().getTimezoneOffset() * 60_000; // approx, el server está en UTC
    const dayStartUtc = new Date(startLocal.getTime() - tzOffsetMs);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60_000);

    // Query citas del día pendientes de recordatorio
    const { data: rows, error } = await supabaseAdmin
      .from('appointments')
      .select(`
        id,
        customer_phone,
        customer_name,
        datetime,
        status,
        no_show_risk_score,
        no_show_reminded,
        services:service_id(name),
        staff:staff_id(name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .gte('datetime', dayStartUtc.toISOString())
      .lt('datetime', dayEndUtc.toISOString())
      .eq('status', 'scheduled')
      .eq('no_show_reminded', false)
      .order('datetime', { ascending: true });

    if (error) {
      return {
        success: false,
        error_code: 'QUERY_FAILED',
        message: 'No pude consultar las citas de mañana.',
      };
    }

    const appointments: PendingAppt[] = (rows || []).map((r) => {
      const { dateFmt, timeFmt } = formatDateTimeMx(r.datetime as string, timezone);
      const svc = r.services as { name?: string } | null;
      const stf = r.staff as { name?: string } | null;
      return {
        appointment_id: r.id as string,
        patient_phone: (r.customer_phone as string) || '',
        patient_name: (r.customer_name as string) || 'paciente',
        datetime_iso: r.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        service: svc?.name ?? null,
        staff_name: stf?.name ?? null,
        no_show_risk_score: Number(r.no_show_risk_score ?? 0),
      };
    });

    return {
      success: true,
      date: args.date,
      count: appointments.length,
      appointments,
    };
  },
});

registerTool('send_confirmation_request', {
  schema: {
    type: 'function',
    function: {
      name: 'send_confirmation_request',
      description: 'Envía template WhatsApp de confirmación 24h antes con CTA "CONFIRMAR / CANCELAR".',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          appointment_datetime: { type: 'string' },
          doctor_name: { type: 'string' },
          service: { type: 'string' },
        },
        required: ['appointment_id', 'patient_phone', 'patient_name', 'appointment_datetime', 'doctor_name', 'service'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 3: mark_confirmed ──────────────────────────────────────────────────
const MarkConfirmedArgs = z
  .object({
    appointment_id: z.string().uuid(),
  })
  .strict();

registerTool('mark_confirmed', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_confirmed',
      description:
        'Marca una cita como confirmada cuando el paciente respondió CONFIRMAR al recordatorio. Scoped por tenant_id para evitar confirmar citas ajenas.',
      parameters: {
        type: 'object',
        properties: { appointment_id: { type: 'string', description: 'UUID de la cita.' } },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkConfirmedArgs.parse(rawArgs);

    const { data: updated, error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId) // scoped — defense in depth
      .eq('status', 'scheduled')     // no re-confirmar canceladas ni pasadas
      .select('id')
      .single();

    if (error || !updated) {
      return {
        success: false,
        error_code: 'NOT_FOUND_OR_NOT_SCHEDULED',
        message:
          'No encontré una cita scheduled con ese ID para este tenant. Puede estar cancelada o ya confirmada.',
      };
    }

    return {
      success: true,
      appointment_id: updated.id as string,
      confirmed_at: new Date().toISOString(),
    };
  },
});

registerTool('mark_no_show', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_no_show',
      description: 'Marca cita como no_show e incrementa contador del paciente. Notifica al dueño.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          reason: { type: 'string', description: 'Opcional' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

registerTool('notify_risk', {
  schema: {
    type: 'function',
    function: {
      name: 'notify_risk',
      description: 'Avisa al dueño cuando un paciente con alto risk_score no ha confirmado.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_name: { type: 'string' },
          appointment_time: { type: 'string' },
          risk_level: { type: 'string', enum: ['high', 'medium'] },
        },
        required: ['appointment_id', 'patient_name', 'appointment_time', 'risk_level'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});
