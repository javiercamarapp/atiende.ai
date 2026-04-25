// ═════════════════════════════════════════════════════════════════════════════
// QUOTING TOOLS — Phase 1
//
// Usa `get_service_quote` (shared/conversion-tools.ts) para la cotización en sí.
// Lo que este archivo aporta es:
//   - save_quote_interest — trackea que el paciente cotizó (con TTL) para que
//     el cron de retención/followup sepa reengaged
//   - schedule_quote_followup — encola un recordatorio 48h después si no agendó
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { assertContactInTenant } from '@/lib/agents/shared/tenant-guards';

const assertContact = (tenantId: string, contactId: string) =>
  assertContactInTenant(tenantId, contactId, 'quoting');

// ─── Tool: save_quote_interest ──────────────────────────────────────────────
const SaveQuoteArgs = z.object({
  services_quoted: z.array(z.string().max(200)).min(1).max(10),
  total_mxn: z.number().min(0).optional(),
  patient_urgency: z.enum(['browsing', 'interested', 'ready_to_book']).default('browsing'),
  notes: z.string().max(500).optional(),
}).strict();

registerTool('save_quote_interest', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_quote_interest',
      description: 'Registra una cotización que el paciente recibió — para que el cron de followup lo recontacte si no agenda. Llamar DESPUÉS de enviar la cotización al paciente. patient_urgency se infiere del tono: "solo preguntando" → browsing; "me interesa" → interested; "lo agendo" → ready_to_book.',
      parameters: {
        type: 'object',
        properties: {
          services_quoted: { type: 'array', items: { type: 'string' } },
          total_mxn: { type: 'number' },
          patient_urgency: { type: 'string', enum: ['browsing', 'interested', 'ready_to_book'] },
          notes: { type: 'string' },
        },
        required: ['services_quoted'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = SaveQuoteArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('contact_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      event_type: 'quote_sent',
      details: {
        services: args.services_quoted,
        total_mxn: args.total_mxn ?? null,
        urgency: args.patient_urgency,
        notes: args.notes ?? null,
        patient_phone: ctx.customerPhone,
      },
    }).select('id').single();

    if (error || !data) return { saved: false, error: error?.message };
    return { saved: true, quote_event_id: data.id as string, urgency: args.patient_urgency };
  },
});

// ─── Tool: schedule_quote_followup ──────────────────────────────────────────
const FollowupArgs = z.object({
  hours_from_now: z.number().int().min(2).max(168).default(48),
  reminder_text: z.string().max(500).optional(),
}).strict();

registerTool('schedule_quote_followup', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'schedule_quote_followup',
      description: 'Agenda un mensaje automático al paciente N horas después preguntando si necesita ayuda para decidir. Usar solo con urgency=browsing/interested — si ready_to_book, agendá directo.',
      parameters: {
        type: 'object',
        properties: {
          hours_from_now: { type: 'number', description: '48 = 2 días (recomendado). Entre 2 y 168 (1 semana).' },
          reminder_text: { type: 'string', description: 'Opcional: mensaje custom. Default: "¿Le quedó alguna duda sobre los precios que le compartimos?"' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = FollowupArgs.parse(rawArgs);
    if (!ctx.contactId) return { scheduled: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { scheduled: false, error: 'contact does not belong to tenant' };
    }

    const sendAt = new Date(Date.now() + args.hours_from_now * 3_600_000);
    const text = args.reminder_text
      || '¿Le quedó alguna duda sobre los precios que le compartimos? Con mucho gusto lo ayudo a agendar su cita.';

    const { error } = await supabaseAdmin.from('scheduled_messages').insert({
      tenant_id: ctx.tenantId,
      patient_phone: ctx.customerPhone,
      message_type: 'follow_up',
      message_content: text,
      scheduled_at: sendAt.toISOString(),
      metadata: { trigger: 'quote_followup', contact_id: ctx.contactId },
    });

    if (error) return { scheduled: false, error: error.message };
    return { scheduled: true, send_at: sendAt.toISOString() };
  },
});
