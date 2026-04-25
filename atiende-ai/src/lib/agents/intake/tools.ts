// ═════════════════════════════════════════════════════════════════════════════
// INTAKE TOOLS — Phase 3.B
// Onboarding del paciente nuevo: recopila historia médica básica, alergias,
// contacto de emergencia, etc.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: send_intake_form ────────────────────────────────────────────────
const SendIntakeArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
  })
  .strict();

registerTool('send_intake_form', {
  isMutation: true,
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

// ─── Tool 2: save_intake_data ────────────────────────────────────────────────
// Campos demográficos (patient_name, age, gender) + datos médicos básicos.
// El LLM puede guardarlos parcialmente en múltiples turnos; la tool hace
// upsert por `tenant_id + phone` preservando lo que ya había guardado
// antes (merge via jsonb concat para intake_data).
const SaveIntakeArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200).optional(),
    age: z.number().int().min(0).max(120).optional(),
    gender: z.enum(['femenino', 'masculino', 'otro', 'prefiero_no_decir']).optional(),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    allergies: z.string().max(1000).optional(),
    chronic_conditions: z.string().max(1000).optional(),
    current_medications: z.string().max(1000).optional(),
    emergency_contact_name: z.string().max(200).optional(),
    emergency_contact_phone: z.string().max(20).optional(),
  })
  .strict();

registerTool('save_intake_data', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_intake_data',
      description: 'Guarda los datos de admisión del paciente (nombre, edad, género, historia médica). Puede llamarse varias veces — siempre hace merge con lo previamente guardado, no sobrescribe.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          patient_name: { type: 'string', description: 'Nombre completo. Se persiste al contacto — úsalo apenas el paciente lo diga.' },
          age: { type: 'number', description: 'Edad en años (0–120). Si el paciente dice "30 años" pasa 30.' },
          gender: {
            type: 'string',
            enum: ['femenino', 'masculino', 'otro', 'prefiero_no_decir'],
            description: 'Género. Normaliza: "mujer"→femenino, "hombre"→masculino.',
          },
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

    // Bug fix: el LLM a veces llamaba save_intake_data SOLO con patient_phone
    // (sin name, age, gender, etc) — eso terminaba haciendo PATCH con
    // intake_data={} y dejando todo vacío. Ahora rechazamos esa llamada y
    // devolvemos error claro al LLM para que reintente con los datos.
    const hasAnyData = Boolean(
      args.patient_name ||
      args.age != null ||
      args.gender ||
      args.birth_date ||
      args.allergies ||
      args.chronic_conditions ||
      args.current_medications ||
      args.emergency_contact_name ||
      args.emergency_contact_phone,
    );
    if (!hasAnyData) {
      return {
        saved: false,
        error: 'no_data_provided',
        next_step:
          'No incluiste ningún dato del paciente. Llamá save_intake_data SOLO cuando el paciente te haya dado un dato real (nombre, edad, género, alergia, etc) y pasalo en el campo correspondiente — no llames el tool con solo patient_phone.',
      };
    }

    // BUG FIX: usábamos .eq('phone', args.patient_phone) que fallaba cuando
    // (a) el phone está cifrado v1:... en BD pero el LLM pasa plain
    // (b) el LLM normaliza el formato (+ prefix, espacios) distinto al stored.
    // Ahora preferimos ctx.contactId que el orchestrator ya tiene resuelto
    // y es UUID estable. Phone queda como fallback solo si no hay contactId.
    let lookupQuery = supabaseAdmin
      .from('contacts')
      .select('intake_data')
      .eq('tenant_id', ctx.tenantId);
    if (ctx.contactId) {
      lookupQuery = lookupQuery.eq('id', ctx.contactId);
    } else {
      lookupQuery = lookupQuery.eq('phone', args.patient_phone);
    }
    const { data: existing } = await lookupQuery.maybeSingle();

    const previousIntake = (existing?.intake_data as Record<string, unknown> | null) || {};

    const newIntakeFields: Record<string, unknown> = {
      age: args.age,
      gender: args.gender,
      allergies: args.allergies,
      chronic_conditions: args.chronic_conditions,
      current_medications: args.current_medications,
      emergency_contact_name: args.emergency_contact_name,
      emergency_contact_phone: args.emergency_contact_phone,
    };
    // Strip undefined para no sobrescribir con null.
    for (const k of Object.keys(newIntakeFields)) {
      if (newIntakeFields[k] === undefined) delete newIntakeFields[k];
    }

    const intake_data = { ...previousIntake, ...newIntakeFields };

    const update: Record<string, unknown> = { intake_data };
    if (args.birth_date) update.birth_date = args.birth_date;
    if (args.patient_name) {
      // patient_name va al campo `name` del contacto (no dentro de JSONB) para
      // que la UI de /contacts y /conversations lo lea sin desempacar el
      // JSONB. encryptPII lo aplicamos acá mismo.
      const { encryptPII } = await import('@/lib/utils/crypto');
      update.name = encryptPII(args.patient_name.trim()) ?? args.patient_name.trim();
    }

    let updateQuery = supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('tenant_id', ctx.tenantId);
    if (ctx.contactId) {
      updateQuery = updateQuery.eq('id', ctx.contactId);
    } else {
      updateQuery = updateQuery.eq('phone', args.patient_phone);
    }
    // Bug fix: agregamos .select('id') para CONFIRMAR que el UPDATE afectó
    // alguna fila. Antes solo veíamos error===null y asumíamos éxito —
    // pero un .eq que no matchea retorna 204 sin error y rows=0.
    const { data: updated, error } = await updateQuery.select('id');

    if (error) return { saved: false, error: error.message };
    if (!updated || updated.length === 0) {
      return {
        saved: false,
        error: 'contact_not_found',
        next_step: `No se encontró el contacto. Verificá que ctx.contactId existe y que el tenant es el correcto. patient_phone="${args.patient_phone}", contact_id="${ctx.contactId ?? 'null'}".`,
      };
    }

    // Bug fix: cuando el bot guarda el nombre, también propagar a
    // conversations.customer_name para que aparezca en /conversations
    // (lista de chats) y no se vea el teléfono. encryptPII para mantener
    // el patrón del resto de la app (decryptPII al leer).
    if (args.patient_name && ctx.conversationId) {
      try {
        const { encryptPII } = await import('@/lib/utils/crypto');
        const trimmed = args.patient_name.trim();
        const enc = encryptPII(trimmed) ?? trimmed;
        await supabaseAdmin
          .from('conversations')
          .update({ customer_name: enc })
          .eq('id', ctx.conversationId)
          .eq('tenant_id', ctx.tenantId);
      } catch (err) {
        console.warn('[save_intake_data] sync customer_name failed:', err instanceof Error ? err.message : err);
      }
    }

    return {
      saved: true,
      fields_saved_this_turn: Object.keys(newIntakeFields).length + (args.patient_name ? 1 : 0),
      name_updated: Boolean(args.patient_name),
      rows_affected: updated.length,
    };
  },
});

// ─── Tool 3: mark_intake_completed ───────────────────────────────────────────
const MarkIntakeArgs = z.object({ patient_phone: z.string().min(6).max(20) }).strict();

registerTool('mark_intake_completed', {
  isMutation: true,
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
    // Bug fix: usar contact_id si está disponible (más estable que phone
    // que puede estar cifrado o tener formato distinto que el que el LLM
    // pasa en patient_phone).
    let q = supabaseAdmin
      .from('contacts')
      .update({
        intake_completed: true,
        intake_completed_at: new Date().toISOString(),
      })
      .eq('tenant_id', ctx.tenantId);
    if (ctx.contactId) {
      q = q.eq('id', ctx.contactId);
    } else {
      q = q.eq('phone', args.patient_phone);
    }
    const { data: updated, error } = await q.select('id');
    if (error) return { marked: false, error: error.message };
    if (!updated || updated.length === 0) {
      return { marked: false, error: 'contact_not_found', next_step: `contact_id=${ctx.contactId ?? 'null'}, phone=${args.patient_phone}` };
    }
    return { marked: true };
  },
});
