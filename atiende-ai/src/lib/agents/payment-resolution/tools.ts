// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT RESOLUTION TOOLS — Phase 1
//
// Disputas de cobro, historial de pagos, solicitudes de factura/recibo.
// Reads de payments + inserts en contact_events para tracking. Los refunds
// reales los hace el dueño — acá solo creamos el ticket con la evidencia.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { notifyOwner } from '@/lib/actions/notifications';
import { assertContactInTenant } from '@/lib/agents/shared/tenant-guards';

const assertContact = (tenantId: string, contactId: string) =>
  assertContactInTenant(tenantId, contactId, 'payment');

// ─── Tool: get_payment_history ─────────────────────────────────────────────
const HistoryArgs = z.object({
  months: z.number().int().min(1).max(24).default(12),
}).strict();

registerTool('get_payment_history', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_payment_history',
      description: 'Lista los últimos N meses de pagos del paciente (default 12). Tabla appointments con campos payment_*. Usar cuando paciente pregunta "¿cuánto he pagado?" o "¿qué cobran en X fecha?".',
      parameters: {
        type: 'object',
        properties: { months: { type: 'number' } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = HistoryArgs.parse(rawArgs);
    if (!ctx.contactId) return { payments: [], error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { payments: [], error: 'contact does not belong to tenant' };
    }

    const cutoff = new Date(Date.now() - args.months * 30 * 86_400_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, duration_minutes, service_id, services:service_id(name, price), status, reason, notes')
      .eq('tenant_id', ctx.tenantId)
      .eq('contact_id', ctx.contactId)
      .gte('datetime', cutoff)
      .order('datetime', { ascending: false })
      .limit(50);

    if (error) return { payments: [], error: error.message };

    const payments = (data || []).map((a) => {
      const svc = Array.isArray(a.services) ? a.services[0] : a.services;
      return {
        appointment_id: a.id,
        date: (a.datetime as string).slice(0, 10),
        service: svc?.name ?? a.reason ?? 'servicio',
        amount_mxn: svc?.price ? Number(svc.price) : null,
        status: a.status,
      };
    });

    return {
      payments,
      total_mxn: payments.reduce((s, p) => s + (p.amount_mxn ?? 0), 0),
      count: payments.length,
    };
  },
});

// ─── Tool: request_invoice ─────────────────────────────────────────────────
const InvoiceArgs = z.object({
  appointment_id: z.string().uuid(),
  rfc: z.string().max(20).optional(),
  business_name: z.string().max(300).optional(),
  email: z.string().email().max(200).optional(),
  cfdi_use: z.string().max(10).optional(),  // "G03" etc
}).strict();

registerTool('request_invoice', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'request_invoice',
      description: 'Paciente pide factura/recibo fiscal (CFDI) de una cita. Registra la solicitud con datos fiscales; el dueño la emite luego vía Facturapi o similar. Si el paciente no dio RFC, pregunta y llamá de nuevo.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          rfc: { type: 'string' },
          business_name: { type: 'string', description: 'Razón social si facturan a empresa.' },
          email: { type: 'string' },
          cfdi_use: { type: 'string', description: 'Ej: G03 (gastos en general), D01 (honorarios médicos).' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = InvoiceArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    // Si el tenant tiene Facturapi configurado Y el paciente dio RFC,
    // intentamos emitir el CFDI real. Sin RFC o sin API key, solo creamos
    // el ticket y el dueño emite manual desde su contador.
    const facturapiKey = ctx.tenant.facturapi_api_key as string | undefined;
    const canAutoIssue = Boolean(facturapiKey && args.rfc);

    // Traer detalles de la cita para monto + descripción
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, customer_name, services:service_id(name, price), reason, payment_amount_mxn')
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    const svc = Array.isArray(apt?.services) ? apt?.services[0] : apt?.services;
    const amountMxn = Number(apt?.payment_amount_mxn ?? svc?.price ?? 0);
    const description = svc?.name
      ? `${svc.name} — ${new Date(apt?.datetime as string).toLocaleDateString('es-MX')}`
      : `Consulta ${new Date(apt?.datetime as string).toLocaleDateString('es-MX')}`;

    // Insert de la invoice en status 'pending' (o 'generating' si vamos a emitir)
    const { data: inv, error: invErr } = await supabaseAdmin.from('invoices').insert({
      tenant_id: ctx.tenantId,
      appointment_id: args.appointment_id,
      contact_id: ctx.contactId,
      receiver_rfc: args.rfc || 'XAXX010101000', // publico en general si no dio RFC
      receiver_name: args.business_name ?? null,
      receiver_email: args.email ?? null,
      cfdi_use: args.cfdi_use ?? 'G03',
      amount_mxn: amountMxn,
      description,
      status: canAutoIssue ? 'generating' : 'pending',
    }).select('id').single();

    if (invErr || !inv) {
      return { created: false, error: invErr?.message || 'invoice_insert_failed' };
    }

    // Si podemos auto-emitir, llamamos Facturapi ahora (fire-and-await)
    if (canAutoIssue && amountMxn > 0) {
      try {
        const { createCfdiInvoice } = await import('@/lib/billing/facturapi');
        const result = await createCfdiInvoice({
          apiKey: facturapiKey!,
          receiverRfc: args.rfc!,
          receiverName: args.business_name,
          receiverEmail: args.email,
          cfdiUse: args.cfdi_use ?? 'G03',
          amountMxn,
          description,
          idempotencyKey: `apt-${args.appointment_id}-${inv.id}`,
        });
        if (result.ok) {
          await supabaseAdmin.from('invoices').update({
            provider: 'facturapi',
            provider_invoice_id: result.invoice.id,
            cfdi_uuid: result.invoice.uuid,
            xml_url: result.invoice.xml,
            pdf_url: result.invoice.pdf,
            status: 'issued',
            issued_at: new Date().toISOString(),
          }).eq('id', inv.id);
          return {
            created: true,
            auto_issued: true,
            invoice_id: inv.id,
            cfdi_uuid: result.invoice.uuid,
            pdf_url: result.invoice.pdf,
          };
        }
        await supabaseAdmin.from('invoices').update({
          status: 'failed',
          error_message: result.error.slice(0, 500),
        }).eq('id', inv.id);
        return {
          created: true,
          auto_issued: false,
          invoice_id: inv.id,
          error: `facturapi_failed: ${result.error}`,
        };
      } catch (err) {
        await supabaseAdmin.from('invoices').update({
          status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
        }).eq('id', inv.id);
        return {
          created: true,
          auto_issued: false,
          invoice_id: inv.id,
          error: 'facturapi_exception',
        };
      }
    }

    // No auto-issue: queda pendiente para que el dueño la emita manual.
    return { created: true, auto_issued: false, invoice_id: inv.id };
  },
});

// ─── Tool: dispute_charge ──────────────────────────────────────────────────
const DisputeArgs = z.object({
  appointment_id: z.string().uuid().optional(),
  amount_mxn: z.number().min(0).optional(),
  reason: z.string().min(5).max(1000),
}).strict();

registerTool('dispute_charge', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'dispute_charge',
      description: 'Paciente dice que un cobro está mal ("no recuerdo que me cobraran esto", "me cobraron doble"). Crea ticket con evidencia; notifica al dueño urgente. Si hay appointment_id específico, incluilo.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          amount_mxn: { type: 'number' },
          reason: { type: 'string', description: 'En palabras del paciente, qué está disputando.' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = DisputeArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('contact_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      event_type: 'charge_disputed',
      details: {
        appointment_id: args.appointment_id ?? null,
        amount_mxn: args.amount_mxn ?? null,
        reason: args.reason,
        patient_phone: ctx.customerPhone,
        status: 'pending',
      },
    }).select('id').single();

    if (error || !data) return { created: false, error: error?.message };

    await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'complaint',
      details:
        `💰 DISPUTA DE COBRO\n\n` +
        `Paciente: ${ctx.customerName || 'sin nombre'} (${ctx.customerPhone})\n` +
        (args.amount_mxn ? `Monto: $${args.amount_mxn}\n` : '') +
        `Motivo: ${args.reason}\n\n` +
        `Event ID: ${data.id}`,
    });

    return { created: true, event_id: data.id as string };
  },
});
