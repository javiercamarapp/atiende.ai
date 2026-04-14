// ═════════════════════════════════════════════════════════════════════════════
// TOOL: cancel_appointment
//
// Cancela la próxima cita en estado scheduled/confirmed del customer que está
// escribiendo. NO acepta un appointment_id del LLM — lo busca server-side
// usando ctx.customerPhone para evitar que el LLM (o un cliente malicioso vía
// prompt injection) cancele citas de otra persona.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTimeMx } from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const argsSchema = z
  .object({
    /** Razón opcional de cancelación, se guarda en notes para registro del staff. */
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

interface CancelSuccessResult {
  success: true;
  cancelled: {
    id: string;
    datetime_iso: string;
    date_human: string;
    time_human: string;
    calendar_unsync_attempted: boolean;
  };
}

interface CancelErrorResult {
  success: false;
  error_code: 'NOT_FOUND' | 'UPDATE_FAILED';
  message: string;
  next_step?: string;
}

type CancelResult = CancelSuccessResult | CancelErrorResult;

async function handler(rawArgs: unknown, ctx: ToolContext): Promise<CancelResult> {
  const args = argsSchema.parse(rawArgs ?? {});
  const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

  // ── Buscar la próxima cita del cliente ──
  // Scoped a tenantId + customerPhone — el LLM no puede cancelar de otro cliente.
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, datetime, google_event_id, notes')
    .eq('tenant_id', ctx.tenantId)
    .eq('customer_phone', ctx.customerPhone)
    .in('status', ['scheduled', 'confirmed'])
    .gte('datetime', new Date().toISOString())
    .order('datetime', { ascending: true })
    .limit(1)
    .single();

  if (!apt) {
    return {
      success: false,
      error_code: 'NOT_FOUND',
      message: 'Este cliente no tiene citas próximas en estado activo.',
      next_step: 'Avísale que no encontraste citas a su nombre, y pregunta si quiere agendar una nueva (puedes llamar book_appointment).',
    };
  }

  // ── UPDATE status ──
  const { error } = await supabaseAdmin
    .from('appointments')
    .update({
      status: 'cancelled',
      notes: args.reason
        ? `${apt.notes ? apt.notes + ' | ' : ''}Cancelado: ${args.reason}`
        : apt.notes,
    })
    .eq('id', apt.id);

  if (error) {
    return {
      success: false,
      error_code: 'UPDATE_FAILED',
      message: 'No pude registrar la cancelación en el sistema.',
      next_step: 'Avísale al cliente que tuviste un problema técnico y que un humano lo va a contactar (puedes llamar escalate_to_human).',
    };
  }

  // ── Cancel calendar event (best effort) ──
  let calendar_unsync_attempted = false;
  if (apt.google_event_id) {
    calendar_unsync_attempted = true;
    try {
      const { cancelCalendarEvent } = await import('@/lib/calendar/google');
      await cancelCalendarEvent('primary', apt.google_event_id);
    } catch (err) {
      console.warn('[tool:cancel_appointment] Calendar unsync failed:', err);
    }
  }

  // ── Marketplace event ──
  try {
    const { executeEventAgents } = await import('@/lib/marketplace/engine');
    await executeEventAgents('appointment.cancelled', {
      tenant_id: ctx.tenantId,
      appointment_id: apt.id,
    });
  } catch {
    /* best effort */
  }

  const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime, timezone);

  return {
    success: true,
    cancelled: {
      id: apt.id,
      datetime_iso: apt.datetime,
      date_human: dateFmt,
      time_human: timeFmt,
      calendar_unsync_attempted,
    },
  };
}

registerTool('cancel_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description:
        'Cancela la próxima cita activa del cliente actual (identificado por su número de WhatsApp). NO acepta IDs del LLM — la búsqueda es scoped server-side por seguridad. Argumento opcional: `reason` (motivo de cancelación que se guarda en las notas del staff).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Opcional: motivo breve de cancelación (ej: "tengo emergencia", "viajo ese día").',
          },
        },
        additionalProperties: false,
      },
    },
  },
  handler,
});
