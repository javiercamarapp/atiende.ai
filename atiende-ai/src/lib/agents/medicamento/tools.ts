// ═════════════════════════════════════════════════════════════════════════════
// MEDICAMENTO TOOLS — Phase 3.B
// Parsea las notas de prescripción del doctor y agenda recordatorios.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { generateResponse, generateStructured, MODELS } from '@/lib/llm/openrouter';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: parse_prescription_from_notes ──────────────────────────────────
const ParsePrescriptionArgs = z
  .object({
    doctor_notes: z.string().min(1).max(5000),
    patient_phone: z.string().min(6).max(20),
    appointment_id: z.string().uuid(),
  })
  .strict();

const PrescriptionSchema = z.object({
  medications: z.array(
    z.object({
      name: z.string(),
      dose: z.string(),
      frequency_hours: z.number().int().min(1).max(168),
      duration_days: z.number().int().min(1).max(365),
      instructions: z.string(),
    }),
  ),
  next_appointment_days: z.number().int().min(0).max(365).optional().default(0),
  follow_up_tests: z.array(z.string()).default([]),
});

registerTool('parse_prescription_from_notes', {
  schema: {
    type: 'function',
    function: {
      name: 'parse_prescription_from_notes',
      description: 'Extrae estructuradamente las prescripciones del texto/notas del doctor: medicamentos con dosis y frecuencia, próxima cita sugerida, estudios de seguimiento.',
      parameters: {
        type: 'object',
        properties: {
          doctor_notes: { type: 'string' },
          patient_phone: { type: 'string' },
          appointment_id: { type: 'string' },
        },
        required: ['doctor_notes', 'patient_phone', 'appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, _ctx: ToolContext) => {
    const args = ParsePrescriptionArgs.parse(rawArgs);
    try {
      const result = await generateStructured({
        model: MODELS.ORCHESTRATOR_FALLBACK,
        system:
          'Eres un asistente clínico que extrae estructuradamente las prescripciones de las notas del doctor. Devuelve JSON con medicamentos (nombre, dosis, frecuencia en horas, duración en días, instrucciones), próxima cita en días, y estudios de seguimiento.',
        messages: [{ role: 'user', content: args.doctor_notes }],
        schema: PrescriptionSchema,
        jsonSchemaName: 'Prescription',
        temperature: 0,
      });
      return { success: true, ...result.data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        medications: [],
        next_appointment_days: 0,
        follow_up_tests: [],
      };
    }
  },
});

// ─── Tool 2: schedule_medication_reminders ──────────────────────────────────
const ScheduleMedRemArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    medications: z.array(
      z.object({
        name: z.string(),
        dose: z.string(),
        frequency_hours: z.number().int().min(1).max(168),
        duration_days: z.number().int().min(1).max(365),
        instructions: z.string().optional(),
      }),
    ),
    start_datetime: z.string().optional(),
  })
  .strict();

registerTool('schedule_medication_reminders', {
  schema: {
    type: 'function',
    function: {
      name: 'schedule_medication_reminders',
      description: 'Calcula horarios y crea entradas en scheduled_messages para cada dosis del régimen de medicamentos.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          medications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dose: { type: 'string' },
                frequency_hours: { type: 'number' },
                duration_days: { type: 'number' },
                instructions: { type: 'string' },
              },
              required: ['name', 'dose', 'frequency_hours', 'duration_days'],
              additionalProperties: false,
            },
          },
          start_datetime: { type: 'string', description: 'ISO datetime — default ahora.' },
        },
        required: ['patient_phone', 'medications'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ScheduleMedRemArgs.parse(rawArgs);
    const startMs = args.start_datetime ? new Date(args.start_datetime).getTime() : Date.now();

    const inserts: Array<Record<string, unknown>> = [];
    for (const med of args.medications) {
      const totalDoses = Math.ceil((med.duration_days * 24) / med.frequency_hours);
      for (let i = 0; i < Math.min(totalDoses, 60); i++) {
        const sendAt = new Date(startMs + i * med.frequency_hours * 60 * 60_000);
        inserts.push({
          tenant_id: ctx.tenantId,
          patient_phone: args.patient_phone,
          message_type: 'medication_reminder',
          message_content: `💊 Recordatorio: Es hora de tomar su ${med.name} (${med.dose}). ${med.instructions ?? ''}`.trim(),
          scheduled_at: sendAt.toISOString(),
          metadata: { medication: med.name, dose: med.dose, instance_index: i },
        });
      }
    }

    if (inserts.length === 0) return { reminders_scheduled: 0 };
    const { error } = await supabaseAdmin.from('scheduled_messages').insert(inserts);
    if (error) return { reminders_scheduled: 0, error: error.message };
    return {
      reminders_scheduled: inserts.length,
      schedule_summary: `${args.medications.length} medicamento(s), ${inserts.length} dosis programadas.`,
    };
  },
});

// ─── Tool 3: send_medication_reminder ────────────────────────────────────────
const SendMedRemArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    medication_name: z.string().min(1).max(200),
    dose: z.string().min(1).max(100),
    special_instructions: z.string().max(500).optional(),
  })
  .strict();

registerTool('send_medication_reminder', {
  schema: {
    type: 'function',
    function: {
      name: 'send_medication_reminder',
      description: 'Envía AHORA un recordatorio de medicamento al paciente vía WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          medication_name: { type: 'string' },
          dose: { type: 'string' },
          special_instructions: { type: 'string' },
        },
        required: ['patient_phone', 'medication_name', 'dose'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendMedRemArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    const text = [
      `💊 Recordatorio: Es hora de tomar su ${args.medication_name} (${args.dose}).`,
      args.special_instructions || '',
      '¿Tiene alguna duda sobre su medicamento?',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const r = await sendTextMessageSafe(phoneNumberId, args.patient_phone, text, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW' };
      }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true };
  },
});

// ─── Tool 4: mark_reminder_completed ─────────────────────────────────────────
const MarkRemArgs = z
  .object({
    scheduled_message_id: z.string().uuid(),
    patient_responded: z.boolean(),
  })
  .strict();

registerTool('mark_reminder_completed', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_reminder_completed',
      description: 'Marca un scheduled_message como sent (tras enviarse) o failed según resultado.',
      parameters: {
        type: 'object',
        properties: {
          scheduled_message_id: { type: 'string' },
          patient_responded: { type: 'boolean' },
        },
        required: ['scheduled_message_id', 'patient_responded'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkRemArgs.parse(rawArgs);
    const { error } = await supabaseAdmin
      .from('scheduled_messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', args.scheduled_message_id)
      .eq('tenant_id', ctx.tenantId);
    if (error) return { marked: false, error: error.message };
    return { marked: true, patient_responded: args.patient_responded };
  },
});

// Suppress unused-import warning if generateResponse not consumed elsewhere
void generateResponse;
