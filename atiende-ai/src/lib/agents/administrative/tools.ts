// ═════════════════════════════════════════════════════════════════════════════
// ADMINISTRATIVE TOOLS — Phase 1
//
// Peticiones no-clínicas: certificados médicos, transferencia de expediente,
// consentimientos firmados, facturas/recibos.
//
// En este PR los tools persisten la petición en contact_events y notifican
// al dueño. La generación real de PDF + firma digital queda como TODO
// (requiere integración con Facturapi o similar).
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { notifyOwner } from '@/lib/actions/notifications';
import { trackError } from '@/lib/monitoring';

async function assertContact(tenantId: string, contactId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('contacts').select('id')
    .eq('id', contactId).eq('tenant_id', tenantId).maybeSingle();
  if (!data) { trackError('administrative_tool_cross_tenant_blocked'); return false; }
  return true;
}

// ─── Tool: request_medical_certificate ─────────────────────────────────────
const CertArgs = z.object({
  appointment_id: z.string().uuid().optional(),
  reason: z.enum(['work', 'school', 'insurance', 'other']),
  days_off_requested: z.number().int().min(0).max(90).optional(),
  custom_text: z.string().max(500).optional(),
}).strict();

registerTool('request_medical_certificate', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'request_medical_certificate',
      description: 'Registra la solicitud del paciente de un certificado/constancia médica. NO genera el PDF directamente — notifica al dueño para que lo emita. days_off_requested si el paciente pide "X días de incapacidad".',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          reason: { type: 'string', enum: ['work', 'school', 'insurance', 'other'] },
          days_off_requested: { type: 'number' },
          custom_text: { type: 'string' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = CertArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('contact_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      event_type: 'certificate_requested',
      details: {
        reason: args.reason,
        days_off_requested: args.days_off_requested ?? null,
        custom_text: args.custom_text ?? null,
        appointment_id: args.appointment_id ?? null,
        patient_phone: ctx.customerPhone,
        status: 'pending',
      },
    }).select('id').single();

    if (error || !data) return { created: false, error: error?.message };

    await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'complaint',
      details:
        `📄 CERTIFICADO MÉDICO solicitado\n\n` +
        `Paciente: ${ctx.customerName || 'sin nombre'} (${ctx.customerPhone})\n` +
        `Motivo: ${args.reason}` +
        (args.days_off_requested ? `\nDías solicitados: ${args.days_off_requested}` : '') +
        (args.custom_text ? `\nDetalle: ${args.custom_text}` : '') +
        `\n\nEvent ID: ${data.id}`,
    });

    return { created: true, event_id: data.id as string };
  },
});

// ─── Tool: request_record_export ───────────────────────────────────────────
const ExportArgs = z.object({
  destination: z.string().max(500).optional(),  // ej. "Consultorio Dr. X en Monterrey"
  format_preference: z.enum(['pdf', 'printed', 'email', 'other']).optional(),
}).strict();

registerTool('request_record_export', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'request_record_export',
      description: 'El paciente pide copia de su expediente médico (portabilidad LFPDPPP/HIPAA). Registra la solicitud y notifica al dueño. NO exporta automáticamente — genera ticket para que el equipo revise y entregue.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'A dónde o a quién va el expediente. Ej: "otro consultorio", "trámite IMSS", "uso personal".' },
          format_preference: { type: 'string', enum: ['pdf', 'printed', 'email', 'other'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = ExportArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('contact_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      event_type: 'record_export_requested',
      details: {
        destination: args.destination ?? null,
        format_preference: args.format_preference ?? 'pdf',
        patient_phone: ctx.customerPhone,
        status: 'pending',
      },
    }).select('id').single();

    if (error || !data) return { created: false, error: error?.message };

    await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'complaint',
      details:
        `📋 EXPORTACIÓN DE EXPEDIENTE solicitada\n\n` +
        `Paciente: ${ctx.customerName || 'sin nombre'} (${ctx.customerPhone})\n` +
        (args.destination ? `Destino: ${args.destination}\n` : '') +
        `Formato: ${args.format_preference || 'pdf'}\n\n` +
        `Plazo legal (LFPDPPP): 20 días hábiles.\n` +
        `Event ID: ${data.id}`,
    });

    return { created: true, event_id: data.id as string };
  },
});

// ─── Tool: request_parental_consent_form ───────────────────────────────────
const ConsentArgs = z.object({
  procedure_name: z.string().min(2).max(300),
  minor_age: z.number().int().min(0).max(17).optional(),
}).strict();

registerTool('request_parental_consent_form', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'request_parental_consent_form',
      description: 'Cuando se requiere consentimiento informado firmado por el tutor de un menor para un procedimiento específico. Crea ticket para que el equipo genere y envíe el formulario.',
      parameters: {
        type: 'object',
        properties: {
          procedure_name: { type: 'string' },
          minor_age: { type: 'number' },
        },
        required: ['procedure_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = ConsentArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('contact_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      event_type: 'consent_form_requested',
      details: {
        procedure: args.procedure_name,
        minor_age: args.minor_age ?? null,
        patient_phone: ctx.customerPhone,
        status: 'pending',
      },
    }).select('id').single();

    if (error || !data) return { created: false, error: error?.message };
    return { created: true, event_id: data.id as string };
  },
});
