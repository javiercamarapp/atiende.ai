// ═════════════════════════════════════════════════════════════════════════════
// COBRANZA TOOLS — Phase 3.B.2
// Cron semanal lunes + trigger post-consulta cuando payment_status='pending'.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage; // referenced for typing; cron path uses sendTextMessageSafe
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: get_pending_payments ───────────────────────────────────────────
const GetPendingArgs = z.object({ tenant_id: z.string().uuid() }).strict();

registerTool('get_pending_payments', {
  schema: {
    type: 'function',
    function: {
      name: 'get_pending_payments',
      description: 'Lista citas completed con payment_status=pending y payment_due_date vencido.',
      parameters: {
        type: 'object',
        properties: { tenant_id: { type: 'string' } },
        required: ['tenant_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetPendingArgs.parse(rawArgs);
    if (args.tenant_id !== ctx.tenantId) return { success: false, error_code: 'TENANT_MISMATCH' };

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select(`
        id, customer_phone, customer_name, payment_due_date, datetime,
        services:service_id(name, price)
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'completed')
      .eq('payment_status', 'pending')
      .lt('payment_due_date', new Date().toISOString())
      .order('payment_due_date', { ascending: true })
      .limit(50);

    if (error) return { success: false, error: error.message, payments: [] };

    return {
      success: true,
      count: (data || []).length,
      payments: (data || []).map((row) => {
        const svc = row.services as { name?: string; price?: number } | null;
        const dueMs = row.payment_due_date
          ? new Date(row.payment_due_date as string).getTime()
          : Date.now();
        const daysOverdue = Math.max(0, Math.floor((Date.now() - dueMs) / (24 * 60 * 60_000)));
        return {
          appointment_id: row.id as string,
          patient_phone: row.customer_phone as string,
          patient_name: (row.customer_name as string) || 'paciente',
          amount_due: svc?.price ?? 0,
          service: svc?.name ?? 'consulta',
          days_overdue: daysOverdue,
        };
      }),
    };
  },
});

// ─── Tool 2: send_payment_reminder ──────────────────────────────────────────
const SendPaymentArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    amount_due: z.number().positive(),
    service: z.string().min(1).max(200),
    days_overdue: z.number().int().min(0),
    payment_methods: z.array(z.string()).optional().default([]),
  })
  .strict();

registerTool('send_payment_reminder', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_payment_reminder',
      description: 'Envía recordatorio de pago. Tono escalado por días vencidos: 1-7 amable, 8-15 segundo aviso, 16-30 formal, 30+ avisa al doctor para seguimiento manual.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          amount_due: { type: 'number' },
          service: { type: 'string' },
          days_overdue: { type: 'number' },
          payment_methods: { type: 'array', items: { type: 'string' } },
        },
        required: ['patient_phone', 'patient_name', 'amount_due', 'service', 'days_overdue'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendPaymentArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    // Si vencimiento > 30 días, no enviar — escalar al doctor
    if (args.days_overdue > 30) {
      try {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        await notifyOwner({
          tenantId: ctx.tenantId,
          event: 'complaint',
          details: `Cobranza vencida >30 días: ${args.patient_phone} (${args.patient_name})\n${args.service} — $${args.amount_due} MXN — ${args.days_overdue} días vencidos`,
        });
      } catch {
        /* best effort */
      }
      return { sent: false, escalated_to_owner: true, days_overdue: args.days_overdue };
    }

    let body: string;
    if (args.days_overdue <= 7) {
      body = `Hola ${args.patient_name}, le recordamos amablemente que tiene un saldo pendiente de $${args.amount_due} MXN por su ${args.service}. Si ya realizó el pago, ignore este mensaje 🙏`;
    } else if (args.days_overdue <= 15) {
      body = `${args.patient_name}, le escribimos para recordarle el pago pendiente de $${args.amount_due} MXN por su ${args.service}. Han pasado ${args.days_overdue} días desde la fecha de pago. Quedamos a sus órdenes para cualquier duda.`;
    } else {
      body = `${args.patient_name}, su saldo de $${args.amount_due} MXN por ${args.service} lleva ${args.days_overdue} días vencido. Por favor comuníquese con el equipo para regularizar su cuenta.`;
    }

    if (args.payment_methods && args.payment_methods.length > 0) {
      body += `\n\nMétodos de pago aceptados: ${args.payment_methods.join(', ')}.`;
    }

    try {
      // FIX 3 (audit Round 2): valida ventana 24h antes de enviar free-form.
      // Si el paciente no nos escribió en las últimas 24h, Meta bloquea el
      // mensaje y puede marcar la cuenta como spam → usar template.
      const r = await sendTextMessageSafe(phoneNumberId, args.patient_phone, body, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW', next_step: 'Use a Meta-approved template via sendTemplate.' };
      }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true, days_overdue: args.days_overdue };
  },
});

// ─── Tool 3: mark_payment_received ──────────────────────────────────────────
const MarkPaidArgs = z
  .object({
    appointment_id: z.string().uuid(),
    amount_paid: z.number().positive(),
    payment_method: z.string().min(1).max(80),
  })
  .strict();

registerTool('mark_payment_received', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'mark_payment_received',
      description: 'Marca la cita como pagada cuando el paciente confirma o el doctor verifica el pago.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          amount_paid: { type: 'number' },
          payment_method: { type: 'string' },
        },
        required: ['appointment_id', 'amount_paid', 'payment_method'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkPaidArgs.parse(rawArgs);
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        payment_status: 'paid',
        payment_method: args.payment_method,
        payment_received_at: new Date().toISOString(),
      })
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId);
    if (error) return { marked: false, error: error.message };

    // Insertar registro en payments
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('customer_phone')
      .eq('id', args.appointment_id)
      .single();
    if (apt) {
      await supabaseAdmin.from('payments').insert({
        tenant_id: ctx.tenantId,
        appointment_id: args.appointment_id,
        customer_phone: apt.customer_phone as string,
        amount: args.amount_paid,
        currency: 'MXN',
        status: 'completed',
        provider: args.payment_method,
      });
    }
    return { marked: true };
  },
});
