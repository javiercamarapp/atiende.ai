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
import { sendTemplate } from '@/lib/whatsapp/send';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

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

// ─── Tool 2: send_confirmation_request ───────────────────────────────────────
const SendConfirmationArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    appointment_datetime: z.string(),
    doctor_name: z.string().min(1).max(200),
    service: z.string().min(1).max(200),
  })
  .strict();

registerTool('send_confirmation_request', {
  schema: {
    type: 'function',
    function: {
      name: 'send_confirmation_request',
      description:
        'Envía el WhatsApp template "appointment_reminder_24h" al paciente pidiéndole que responda CONFIRMAR o CANCELAR. Marca la cita con no_show_reminded=true y reminded_at=NOW() al terminar. Si el envío falla, retorna {sent:false, error} — NO lanza excepción, el worker debe continuar con la siguiente cita.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita.' },
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          appointment_datetime: { type: 'string', description: 'ISO datetime de la cita (ctx.tenant.timezone).' },
          doctor_name: { type: 'string' },
          service: { type: 'string' },
        },
        required: ['appointment_id', 'patient_phone', 'patient_name', 'appointment_datetime', 'doctor_name', 'service'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendConfirmationArgs.parse(rawArgs);
    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) {
      return {
        sent: false,
        error: 'Tenant sin wa_phone_number_id configurado.',
        error_code: 'TENANT_NOT_CONFIGURED',
      };
    }

    const { dateFmt, timeFmt } = formatDateTimeMx(args.appointment_datetime, timezone);

    try {
      await sendTemplate(
        phoneNumberId,
        args.patient_phone,
        'appointment_reminder_24h',
        [
          args.patient_name,
          (ctx.tenant.name as string) || 'el consultorio',
          `${dateFmt} a las ${timeFmt}`,
          args.doctor_name,
          args.service,
        ],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[tool:send_confirmation_request] template send failed:', msg);
      return {
        sent: false,
        error: msg,
        error_code: 'TEMPLATE_SEND_FAILED',
        appointment_id: args.appointment_id,
      };
    }

    // Marcar como recordado. Si falla el UPDATE pero el mensaje ya se envió,
    // el caller debe saberlo para NO contar la cita como "recordatorio enviado"
    // en el próximo cron (si el cron se re-ejecuta, pediría template duplicado).
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        no_show_reminded: true,
        reminded_at: new Date().toISOString(),
      })
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId);

    let updateFailed = false;
    let updateError: string | undefined;
    if (updErr) {
      updateFailed = true;
      updateError = updErr.message;
      // ERROR, no warn — esto es un bug potencial (spam risk)
      console.error(
        '[tool:send_confirmation_request] UPDATE no_show_reminded FAILED after successful send. Patient may get duplicate reminder on next cron run:',
        {
          appointment_id: args.appointment_id,
          tenant_id: ctx.tenantId,
          patient_phone: args.patient_phone,
          error: updErr.message,
        },
      );
    }

    // Audit log (best effort)
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: ctx.tenantId,
        action: 'no_show.reminder_sent',
        entity_type: 'appointment',
        entity_id: args.appointment_id,
        details: { patient_phone: args.patient_phone },
      });
    } catch {
      /* best effort */
    }

    return {
      sent: true,
      appointment_id: args.appointment_id,
      template: 'appointment_reminder_24h',
      reminded_at: new Date().toISOString(),
      update_failed: updateFailed,
      update_error: updateError,
    };
  },
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

// ─── Tool 4: mark_no_show ────────────────────────────────────────────────────
const MarkNoShowArgs = z
  .object({
    appointment_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  })
  .strict();

registerTool('mark_no_show', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_no_show',
      description:
        'Marca una cita como no_show e incrementa el contador en el contacto para elevar el risk_score futuro. Notifica al dueño. Scoped por tenant_id.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita.' },
          reason: { type: 'string', description: 'Opcional: motivo observado.' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkNoShowArgs.parse(rawArgs);
    const timezone = (ctx.tenant.timezone as string) || 'America/Merida';

    // 1. SELECT scoped para obtener el customer_phone + datetime
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, customer_phone, customer_name, datetime, status')
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .single();

    if (!apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'Cita no encontrada para este tenant.',
      };
    }

    if (apt.status === 'no_show') {
      return {
        success: true,
        already_marked: true,
        appointment_id: apt.id as string,
      };
    }

    // 2. UPDATE appointment
    const { error: aptErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'no_show',
        cancellation_reason: args.reason ?? null,
      })
      .eq('id', apt.id);

    if (aptErr) {
      return {
        success: false,
        error_code: 'UPDATE_FAILED',
        message: aptErr.message,
      };
    }

    // 3. Incrementar no_show_count en contacts (best effort — el trigger SQL
    //    podría hacerlo automáticamente; aquí es fallback).
    try {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('id, no_show_count')
        .eq('tenant_id', ctx.tenantId)
        .eq('phone', apt.customer_phone as string)
        .single();

      if (contact) {
        await supabaseAdmin
          .from('contacts')
          .update({ no_show_count: ((contact.no_show_count as number) || 0) + 1 })
          .eq('id', contact.id);
      }
    } catch (err) {
      console.warn('[tool:mark_no_show] contact counter update failed:', err);
    }

    // 4. Notificar al dueño
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'complaint', // reuse — no existe 'no_show' evento nativo
        details: `No-show: ${apt.customer_name || apt.customer_phone}\nCita: ${dateFmt} ${timeFmt}${args.reason ? `\nMotivo: ${args.reason}` : ''}`,
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      appointment_id: apt.id as string,
      slot_freed: true,
    };
  },
});

// ─── Tool 5: notify_risk ─────────────────────────────────────────────────────
const NotifyRiskArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_name: z.string().min(1).max(200),
    appointment_time: z.string().min(1).max(100),
    risk_level: z.enum(['high', 'medium']),
  })
  .strict();

registerTool('notify_risk', {
  schema: {
    type: 'function',
    function: {
      name: 'notify_risk',
      description:
        'Envía alerta al dueño del tenant sobre un paciente con alto riesgo de no-show que aún no ha confirmado. Úsalo cuando risk_score >= 70 y no_show_reminded=true pero confirmed_at es null.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita.' },
          patient_name: { type: 'string' },
          appointment_time: { type: 'string', description: 'Hora formateada, ej "10:00 am".' },
          risk_level: { type: 'string', enum: ['high', 'medium'] },
        },
        required: ['appointment_id', 'patient_name', 'appointment_time', 'risk_level'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = NotifyRiskArgs.parse(rawArgs);

    const emoji = args.risk_level === 'high' ? '⚠️🔴' : '⚠️';
    const label = args.risk_level === 'high' ? 'ALTO' : 'MEDIO';
    const details = `${emoji} Riesgo ${label} de no-show\nPaciente: ${args.patient_name}\nHora mañana: ${args.appointment_time}\nNo ha respondido al recordatorio.`;

    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'lead_hot', // reuse — más cercano al "necesita atención proactiva"
        details,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error_code: 'NOTIFY_FAILED',
        message: msg,
      };
    }

    // Audit log
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: ctx.tenantId,
        action: 'no_show.risk_notified',
        entity_type: 'appointment',
        entity_id: args.appointment_id,
        details: {
          patient_name: args.patient_name,
          risk_level: args.risk_level,
        },
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      appointment_id: args.appointment_id,
      risk_level: args.risk_level,
      owner_notified: true,
    };
  },
});
