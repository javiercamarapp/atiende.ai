// ═════════════════════════════════════════════════════════════════════════════
// INTAKE TOOLS — Phase 3.B
// Onboarding del paciente nuevo: recopila historia médica básica, alergias,
// contacto de emergencia, etc.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: send_intake_form ────────────────────────────────────────────────
const SendIntakeArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
  })
  .strict();

registerTool('send_intake_form', {
  schema: {
    type: 'function',
    function: {
      name: 'send_intake_form',
      description: 'Envía las preguntas de admisión a un paciente nuevo via WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
        },
        required: ['patient_phone', 'patient_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendIntakeArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    const text = [
      `¡Bienvenido(a) ${args.patient_name}! 🌿`,
      '',
      'Para brindarle la mejor atención, necesitamos algunos datos básicos:',
      '',
      '1️⃣ Fecha de nacimiento (DD/MM/AAAA)',
      '2️⃣ ¿Tiene alguna alergia conocida? (medicamentos, alimentos, etc.)',
      '3️⃣ ¿Padece alguna enfermedad crónica? (diabetes, hipertensión, etc.)',
      '4️⃣ ¿Toma actualmente algún medicamento de forma permanente?',
      '5️⃣ Nombre y teléfono de un contacto de emergencia',
      '',
      'Sus datos son estrictamente confidenciales. Puede responder cuando guste 🙏',
    ].join('\n');

    try {
      await sendTextMessage(phoneNumberId, args.patient_phone, text);
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true };
  },
});

// ─── Tool 2: save_intake_data ────────────────────────────────────────────────
const SaveIntakeArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    allergies: z.string().max(1000).optional(),
    chronic_conditions: z.string().max(1000).optional(),
    current_medications: z.string().max(1000).optional(),
    emergency_contact_name: z.string().max(200).optional(),
    emergency_contact_phone: z.string().max(20).optional(),
  })
  .strict();

registerTool('save_intake_data', {
  schema: {
    type: 'function',
    function: {
      name: 'save_intake_data',
      description: 'Guarda los datos de admisión que el paciente respondió. Sobrescribe si ya existían.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          birth_date: { type: 'string', description: 'YYYY-MM-DD' },
          allergies: { type: 'string' },
          chronic_conditions: { type: 'string' },
          current_medications: { type: 'string' },
          emergency_contact_name: { type: 'string' },
          emergency_contact_phone: { type: 'string' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SaveIntakeArgs.parse(rawArgs);

    const intake_data: Record<string, string | undefined> = {
      allergies: args.allergies,
      chronic_conditions: args.chronic_conditions,
      current_medications: args.current_medications,
      emergency_contact_name: args.emergency_contact_name,
      emergency_contact_phone: args.emergency_contact_phone,
    };
    // Strip undefined keys
    for (const k of Object.keys(intake_data)) {
      if (intake_data[k] === undefined) delete intake_data[k];
    }

    const update: Record<string, unknown> = { intake_data };
    if (args.birth_date) update.birth_date = args.birth_date;

    const { error } = await supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', args.patient_phone);

    if (error) return { saved: false, error: error.message };
    return { saved: true, fields_count: Object.keys(intake_data).length };
  },
});

// ─── Tool 3: mark_intake_completed ───────────────────────────────────────────
const MarkIntakeArgs = z.object({ patient_phone: z.string().min(6).max(20) }).strict();

registerTool('mark_intake_completed', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_intake_completed',
      description: 'Marca el intake del paciente como completado para que el orquestador no lo vuelva a disparar.',
      parameters: {
        type: 'object',
        properties: { patient_phone: { type: 'string' } },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkIntakeArgs.parse(rawArgs);
    const { error } = await supabaseAdmin
      .from('contacts')
      .update({
        intake_completed: true,
        intake_completed_at: new Date().toISOString(),
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', args.patient_phone);
    if (error) return { marked: false, error: error.message };
    return { marked: true };
  },
});
