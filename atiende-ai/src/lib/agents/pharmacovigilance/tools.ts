// ═════════════════════════════════════════════════════════════════════════════
// PHARMACOVIGILANCE TOOLS — Phase 1
//
// Reacción adversa a medicamento. Crítico legal (COFEPRIS). Requiere:
//   1. Persistir en tabla estructurada (adverse_events)
//   2. Notificar al dueño INMEDIATO
//   3. Responder al paciente con guía pre-aprobada (NO recomendar ni dosis)
//
// El agente NUNCA responde con indicación médica propia — deriva siempre
// al doctor. Si severity='life_threatening' responde con teléfono de urgencia
// + 911.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { notifyOwner } from '@/lib/actions/notifications';
import { assertContactInTenant } from '@/lib/agents/shared/tenant-guards';

const assertContact = (tenantId: string, contactId: string) =>
  assertContactInTenant(tenantId, contactId, 'pharmaco');

// ─── Tool: save_adverse_event ──────────────────────────────────────────────
const SaveAdverseArgs = z.object({
  medication: z.string().min(2).max(300),
  symptoms: z.string().min(3).max(1000),
  onset_hours: z.number().int().min(0).max(720).optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
  appointment_id: z.string().uuid().optional(),
}).strict();

registerTool('save_adverse_event', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_adverse_event',
      description: 'Registra una reacción adversa a medicamento reportada por el paciente. severity: mild=molesto-pero-funcional; moderate=afecta actividades; severe=necesita ver doctor HOY; life_threatening=911 ahora. Notifica al dueño automáticamente.',
      parameters: {
        type: 'object',
        properties: {
          medication: { type: 'string', description: 'Nombre del medicamento reportado. Ej: "amoxicilina 500mg".' },
          symptoms: { type: 'string', description: 'Síntomas en palabras del paciente. Ej: "ronchas en brazos, comezón, 3 horas después de la pastilla".' },
          onset_hours: { type: 'number', description: 'Horas entre primera dosis y aparición del síntoma, si el paciente lo dijo.' },
          severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'life_threatening'] },
          appointment_id: { type: 'string', description: 'Opcional: UUID de la cita donde se recetó.' },
        },
        required: ['medication', 'symptoms', 'severity'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = SaveAdverseArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('adverse_events').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      appointment_id: args.appointment_id ?? null,
      medication: args.medication,
      symptoms: args.symptoms,
      onset_hours: args.onset_hours ?? null,
      severity: args.severity,
      patient_phone: ctx.customerPhone,
      status: 'pending',
    }).select('id').single();

    if (error || !data) return { saved: false, error: error?.message };

    // Notificación IMMEDIATE al dueño — pharmacovigilancia es tiempo-crítico.
    const icon = args.severity === 'life_threatening' ? '🚨🚨🚨'
               : args.severity === 'severe'          ? '🚨'
               : args.severity === 'moderate'        ? '⚠️'
                                                     : 'ℹ️';
    await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'complaint',
      details:
        `${icon} REACCIÓN ADVERSA (${args.severity.toUpperCase()})\n\n` +
        `Paciente: ${ctx.customerName || 'sin nombre'} (${ctx.customerPhone})\n` +
        `Medicamento: ${args.medication}\n` +
        `Síntomas: ${args.symptoms}` +
        (args.onset_hours ? `\nInicio: ~${args.onset_hours}h después de dosis` : '') +
        `\n\nEvento ID: ${data.id}`,
    });

    // Marcar que el dueño fue notificado (best-effort, no bloquea response).
    void supabaseAdmin.from('adverse_events')
      .update({ doctor_notified: true, doctor_notified_at: new Date().toISOString() })
      .eq('id', data.id);

    return {
      saved: true,
      adverse_event_id: data.id as string,
      severity: args.severity,
      owner_notified: true,
    };
  },
});

// ─── Tool: get_doctor_guidance ─────────────────────────────────────────────
// Devuelve la frase pre-aprobada para responder al paciente. El agente NO
// debe dar indicaciones médicas propias — solo leer de aquí.
const GuidanceArgs = z.object({
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
}).strict();

registerTool('get_doctor_guidance', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_doctor_guidance',
      description: 'Devuelve texto pre-aprobado para responder al paciente según severity. No genera nuevo contenido clínico — solo consulta el texto estándar. El agente debe RESPONDER con este texto literal (o muy cercano).',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'life_threatening'] },
        },
        required: ['severity'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = GuidanceArgs.parse(rawArgs);

    // Read tenant emergency_phone para incluir en life_threatening.
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('phone, emergency_phone')
      .eq('id', ctx.tenantId).maybeSingle();
    const emergencyPhone = (tenant?.emergency_phone as string) || (tenant?.phone as string) || '';

    const guidance: Record<string, string> = {
      life_threatening:
        `Por lo que me describe, es urgente. Llame AHORA al 911 o al ${emergencyPhone || 'número de emergencias del consultorio'}. ` +
        `NO tome más el medicamento. Si tiene dificultad para respirar, acuda al servicio de urgencias más cercano.`,
      severe:
        `Esto requiere atención médica HOY. Por favor suspenda el medicamento y comuníquese al ${emergencyPhone || 'consultorio'} para que el doctor lo vea lo antes posible. Ya quedó notificado.`,
      moderate:
        `Lamento que se sienta así. Suspenda el medicamento hasta que el doctor lo evalúe. Voy a coordinarle una cita o llamada con él — ya quedó notificado del caso.`,
      mild:
        `Gracias por avisarnos. Ya registré el evento y el doctor fue notificado. ` +
        `Mientras tanto, observe si los síntomas empeoran; si aparece hinchazón, dificultad para respirar o fiebre, acuda a urgencias de inmediato.`,
    };

    return {
      response_text: guidance[args.severity],
      emergency_phone: emergencyPhone,
    };
  },
});
