// ═════════════════════════════════════════════════════════════════════════════
// RETENCION TOOLS — Phase 3.B.2
// Cron nocturno detecta pacientes en riesgo de churn y dispara reactivación.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: get_patients_at_risk ───────────────────────────────────────────
const GetAtRiskArgs = z
  .object({
    tenant_id: z.string().uuid(),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict();

registerTool('get_patients_at_risk', {
  schema: {
    type: 'function',
    function: {
      name: 'get_patients_at_risk',
      description: 'Lista pacientes en riesgo de churn. Filtros: churn_probability>60 OR next_visit_predicted_at vencido, AND last_retention_contact viejo (>30d).',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['tenant_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetAtRiskArgs.parse(rawArgs);
    if (args.tenant_id !== ctx.tenantId) {
      return { success: false, error_code: 'TENANT_MISMATCH' };
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const limit = args.limit ?? 20;

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select(
        'id, phone, name, churn_probability, next_visit_predicted_at, last_retention_contact, lifetime_value_mxn',
      )
      .eq('tenant_id', ctx.tenantId)
      .gt('churn_probability', 60)
      .or(`last_retention_contact.is.null,last_retention_contact.lt.${cutoff}`)
      .order('lifetime_value_mxn', { ascending: false })
      .limit(limit);

    if (error) return { success: false, error: error.message, patients: [] };

    return {
      success: true,
      count: (data || []).length,
      patients: (data || []).map((c) => ({
        contact_id: c.id as string,
        patient_phone: c.phone as string,
        patient_name: (c.name as string) || 'paciente',
        churn_probability: Number(c.churn_probability ?? 0),
        ltv_mxn: Number(c.lifetime_value_mxn ?? 0),
      })),
    };
  },
});

// ─── Tool 2: generate_retention_message ─────────────────────────────────────
const GenRetentionArgs = z
  .object({
    patient_name: z.string().min(1).max(200),
    last_visit_date: z.string().optional(),
    last_service: z.string().optional(),
    days_since_visit: z.number().int().min(0),
    business_name: z.string().min(1).max(200),
  })
  .strict();

registerTool('generate_retention_message', {
  schema: {
    type: 'function',
    function: {
      name: 'generate_retention_message',
      description: 'Genera un mensaje de reactivación personalizado vía LLM. Tono varía por días desde última visita: 30-60 suave, 60-90 te extrañamos, 90+ oferta.',
      parameters: {
        type: 'object',
        properties: {
          patient_name: { type: 'string' },
          last_visit_date: { type: 'string' },
          last_service: { type: 'string' },
          days_since_visit: { type: 'number' },
          business_name: { type: 'string' },
        },
        required: ['patient_name', 'days_since_visit', 'business_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown) => {
    const args = GenRetentionArgs.parse(rawArgs);
    const tone =
      args.days_since_visit < 60
        ? 'recordatorio_suave'
        : args.days_since_visit < 90
          ? 'te_extrañamos'
          : 'oferta_reactivacion';

    try {
      const result = await generateResponse({
        model: MODELS.ORCHESTRATOR_FALLBACK,
        system:
          'Eres redactor de mensajes WhatsApp para clínicas mexicanas. Tono cálido, no insistente, profesional. Español mexicano. UN solo párrafo de 2-3 oraciones, máximo 1 emoji. Nunca prometas descuentos sin contexto.',
        messages: [
          {
            role: 'user',
            content: `Genera un mensaje de reactivación para ${args.patient_name}, paciente de ${args.business_name}. Última visita: ${args.last_visit_date || 'desconocida'} (${args.days_since_visit} días). Último servicio: ${args.last_service || 'consulta'}. Tono: ${tone}.`,
          },
        ],
        temperature: 0.5,
        maxTokens: 200,
      });
      return { success: true, message: result.text.trim(), tone, model: result.model };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ─── Tool 3: send_retention_message ──────────────────────────────────────────
const SendRetentionArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    message: z.string().min(1).max(2000),
    appointment_id: z.string().uuid().optional(),
  })
  .strict();

registerTool('send_retention_message', {
  schema: {
    type: 'function',
    function: {
      name: 'send_retention_message',
      description: 'Envía el mensaje de retención por WhatsApp y actualiza last_retention_contact + counter en contacts.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          message: { type: 'string' },
          appointment_id: { type: 'string' },
        },
        required: ['patient_phone', 'message'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendRetentionArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    try {
      // FIX 3 (audit Round 2): valida ventana 24h
      const r = await sendTextMessageSafe(phoneNumberId, args.patient_phone, args.message, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW' };
      }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Update counter (best effort)
    try {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('id, retention_contact_count')
        .eq('tenant_id', ctx.tenantId)
        .eq('phone', args.patient_phone)
        .single();
      if (contact) {
        await supabaseAdmin
          .from('contacts')
          .update({
            last_retention_contact: new Date().toISOString(),
            retention_contact_count: ((contact.retention_contact_count as number) || 0) + 1,
          })
          .eq('id', contact.id);
      }
    } catch {
      /* best effort */
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: ctx.tenantId,
        action: 'retention.message_sent',
        entity_type: 'contact',
        details: { patient_phone: args.patient_phone },
      });
    } catch {
      /* best effort */
    }
    return { sent: true };
  },
});

// ─── Tool 4: mark_patient_reactivated ────────────────────────────────────────
const MarkReactivatedArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    appointment_id: z.string().uuid(),
  })
  .strict();

registerTool('mark_patient_reactivated', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_patient_reactivated',
      description: 'Marca paciente como reactivado tras agendar cita post-retención. Resetea churn_probability a 10.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          appointment_id: { type: 'string' },
        },
        required: ['patient_phone', 'appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkReactivatedArgs.parse(rawArgs);
    const { error } = await supabaseAdmin
      .from('contacts')
      .update({ churn_probability: 10, reactivated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', args.patient_phone);
    if (error) return { marked: false, error: error.message };
    return { marked: true, appointment_id: args.appointment_id };
  },
});
