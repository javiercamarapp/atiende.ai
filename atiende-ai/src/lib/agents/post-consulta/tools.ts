// ═════════════════════════════════════════════════════════════════════════════
// POST-CONSULTA TOOLS — Phase 3.B
//
// Worker disparado por evento (cuando appointment.status pasa a 'completed').
// Tareas: enviar instrucciones post-visita, agendar próximo recordatorio,
// y pasar la batuta a COBRANZA si quedó saldo pendiente.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: get_appointment_details ─────────────────────────────────────────
const GetApptArgs = z.object({ appointment_id: z.string().uuid() }).strict();

registerTool('get_appointment_details', {
  schema: {
    type: 'function',
    function: {
      name: 'get_appointment_details',
      description: 'Trae los detalles completos de una cita completada para generar instrucciones post-visita.',
      parameters: {
        type: 'object',
        properties: { appointment_id: { type: 'string' } },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetApptArgs.parse(rawArgs);
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select(`
        id, customer_phone, customer_name, datetime, duration_minutes, status,
        doctor_notes, payment_status, payment_due_date,
        services:service_id(name, duration_minutes, price),
        staff:staff_id(name)
      `)
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (error || !data) {
      return { success: false, error_code: 'NOT_FOUND', message: error?.message };
    }
    const svc = data.services as { name?: string; price?: number } | null;
    const stf = data.staff as { name?: string } | null;
    return {
      success: true,
      appointment_id: data.id as string,
      patient_phone: data.customer_phone as string,
      patient_name: (data.customer_name as string) || 'paciente',
      service: svc?.name ?? null,
      service_price: svc?.price ?? null,
      staff_name: stf?.name ?? null,
      doctor_notes: (data.doctor_notes as string) || '',
      payment_status: (data.payment_status as string) || 'pending',
      payment_due_date: data.payment_due_date as string | null,
    };
  },
});

// ─── Tool 2: send_post_visit_instructions ───────────────────────────────────
const SendInstructionsArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    service: z.string().min(1).max(200),
    doctor_notes: z.string().optional(),
    next_appointment_days: z.number().int().min(1).max(365).optional(),
  })
  .strict();

registerTool('send_post_visit_instructions', {
  schema: {
    type: 'function',
    function: {
      name: 'send_post_visit_instructions',
      description: 'Envía mensaje WhatsApp post-visita personalizado y marca post_visit_sent=true.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          service: { type: 'string' },
          doctor_notes: { type: 'string', description: 'Indicaciones del doctor.' },
          next_appointment_days: { type: 'number', description: 'Días para próxima cita sugerida.' },
        },
        required: ['appointment_id', 'patient_phone', 'patient_name', 'service'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendInstructionsArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    const lines = [
      `Hola ${args.patient_name}, gracias por su visita 🌿`,
      `Esperamos que su consulta de ${args.service} haya sido satisfactoria.`,
    ];
    if (args.doctor_notes) lines.push('', '📝 Indicaciones del doctor:', args.doctor_notes);
    if (args.next_appointment_days) {
      lines.push('', `Le recomendamos su próxima cita en aproximadamente ${args.next_appointment_days} días.`);
    }
    lines.push('', 'Si tiene cualquier duda, estamos para servirle.');
    const text = lines.join('\n');

    try {
      await sendTextMessage(phoneNumberId, args.patient_phone, text);
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    await supabaseAdmin
      .from('appointments')
      .update({ post_visit_sent: true, post_visit_sent_at: new Date().toISOString() })
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId);
    return { sent: true, appointment_id: args.appointment_id };
  },
});

// ─── Tool 3: schedule_next_appointment_reminder ─────────────────────────────
const ScheduleReminderArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    days_until_next: z.number().int().min(1).max(365),
    service_type: z.string().min(1).max(200),
  })
  .strict();

registerTool('schedule_next_appointment_reminder', {
  schema: {
    type: 'function',
    function: {
      name: 'schedule_next_appointment_reminder',
      description: 'Encola un recordatorio de retención en scheduled_messages para enviar en N días.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          days_until_next: { type: 'number' },
          service_type: { type: 'string' },
        },
        required: ['patient_phone', 'days_until_next', 'service_type'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ScheduleReminderArgs.parse(rawArgs);
    const sendAt = new Date(Date.now() + args.days_until_next * 24 * 60 * 60_000);
    const message = `Hola, ya pasaron ${args.days_until_next} días desde su última visita. ¿Le gustaría agendar su seguimiento de ${args.service_type}?`;
    const { error } = await supabaseAdmin.from('scheduled_messages').insert({
      tenant_id: ctx.tenantId,
      patient_phone: args.patient_phone,
      message_type: 'retention',
      message_content: message,
      scheduled_at: sendAt.toISOString(),
    });
    if (error) return { scheduled: false, error: error.message };
    return { scheduled: true, scheduled_at: sendAt.toISOString() };
  },
});

// ─── Tool 4: request_payment_if_pending ──────────────────────────────────────
const RequestPaymentArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    amount_due: z.number().positive(),
  })
  .strict();

registerTool('request_payment_if_pending', {
  schema: {
    type: 'function',
    function: {
      name: 'request_payment_if_pending',
      description: 'Si la cita tiene saldo pendiente, envía mensaje cortés solicitando el pago. Si ya está pagada, no hace nada.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          amount_due: { type: 'number' },
        },
        required: ['appointment_id', 'patient_phone', 'amount_due'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = RequestPaymentArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    const text = `Le recordamos amablemente que tiene un saldo pendiente de $${args.amount_due} MXN por su consulta. Si ya realizó el pago, ignore este mensaje. Para cualquier duda estamos a sus órdenes 🙏`;
    try {
      await sendTextMessage(phoneNumberId, args.patient_phone, text);
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true, amount_due: args.amount_due };
  },
});
