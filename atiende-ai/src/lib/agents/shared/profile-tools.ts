// ═════════════════════════════════════════════════════════════════════════════
// SHARED PROFILE TOOLS — enriquecen el perfil del paciente desde cualquier
// conversación (agenda, intake, encuesta). El LLM los invoca cuando detecta
// información nueva en el mensaje del paciente que vale la pena persistir.
//
// Cinco tools:
//   1. update_patient_profile     — upsert nombre/edad/alergias/etc a contacts
//   2. save_patient_document      — persiste referencia a foto/PDF/audio
//   3. escalate_urgency           — notifica al dueño + marca emergency_flag
//   4. create_referred_contact    — nuevo prospect referido por el paciente
//   5. save_patient_preferences   — preferencias de comunicación (horarios, nickname)
//
// Registrados como side-effect al importar. El AGENT_REGISTRY los incluye
// bajo `agenda` e `intake` (los dos agentes conversacionales que ven
// mensajes libres del paciente). Encuesta/no-show no los necesitan porque
// su flow es de 1-2 turnos estructurados.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { encryptPII } from '@/lib/utils/crypto';
import { notifyOwner } from '@/lib/actions/notifications';
import { trackError } from '@/lib/monitoring';

/**
 * Defense-in-depth: `supabaseAdmin` bypassa RLS, así que si un prompt
 * injection o un bug en el orquestador contamina `ctx.contactId` con
 * un UUID de OTRO tenant, las profile tools escribirían al perfil
 * equivocado. Este helper hace una query previa que verifica que el
 * contacto pertenece al tenantId del contexto. Retorna el row si OK,
 * `null` si no existe o es de otro tenant (tool aborta).
 *
 * Costo: 1 extra round-trip a Supabase por tool call (~20-40ms). Dado
 * que las profile tools son fire-and-forget durante la conversación,
 * la latencia extra es aceptable para cerrar el gap cross-tenant.
 */
async function assertContactBelongsToTenant(
  tenantId: string,
  contactId: string,
): Promise<boolean> {
  if (!tenantId || !contactId) return false;
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    trackError('profile_tool_tenant_check_error');
    console.warn('[profile-tools] tenant assertion query failed', { tenantId, contactId, err: error.message });
    return false;
  }
  if (!data) {
    // Esto es un SIGNAL de bug o ataque — loggear como error, no warn.
    trackError('profile_tool_cross_tenant_blocked');
    console.error('[profile-tools] BLOCKED cross-tenant access attempt', {
      tenantId,
      contactId,
    });
    return false;
  }
  return true;
}

// ─── Helper: log evento para timeline del contacto ──────────────────────────
async function logContactEvent(opts: {
  tenantId: string;
  contactId: string;
  eventType: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin.from('contact_events').insert({
      tenant_id: opts.tenantId,
      contact_id: opts.contactId,
      event_type: opts.eventType,
      details: opts.details,
    });
  } catch (err) {
    // Antes silenciábamos 100%. Ahora incrementamos counter para que
    // Ops vea spikes en el dashboard aunque los events sean "best
    // effort" — si dejan de loguearse de repente, queremos saber.
    trackError('contact_event_log_failed');
    console.warn('[profile-tools] logContactEvent failed', err instanceof Error ? err.message : err);
  }
}

// ─── Tool 1: update_patient_profile ─────────────────────────────────────────
// Para cuando el paciente menciona info nueva en MEDIO de una conversación
// ("ya me mudé a Monterrey", "soy alérgico al látex", "cambié de seguro a
// GNP"). NO reemplaza al intake — ese sigue siendo el flow inicial dedicado.
// Este tool hace merge sobre intake_data (JSONB) o campos top-level de
// contacts según aplique.
const UpdateProfileArgs = z
  .object({
    // Campos top-level de contacts (van a columnas dedicadas)
    full_name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(200).optional(),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Campos que viven en intake_data (JSONB). Siempre merge, nunca overwrite.
    allergies: z.string().max(1000).optional(),
    chronic_conditions: z.string().max(1000).optional(),
    current_medications: z.string().max(1000).optional(),
    emergency_contact_name: z.string().max(200).optional(),
    emergency_contact_phone: z.string().max(20).optional(),
    insurance: z.string().max(200).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    family_history: z.string().max(1000).optional(),
    // Razón en lenguaje natural de por qué actualizamos (para audit)
    reason: z.string().max(300).optional(),
  })
  .strict();

registerTool('update_patient_profile', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'update_patient_profile',
      description:
        'Actualiza el perfil del paciente cuando menciona información nueva en la conversación. Usar apenas lo detecten — NO esperar al final del turno. Hace merge sobre lo que ya está guardado; nunca sobrescribe campos que no mandaste. Ejemplos: "me mudé a Monterrey" → city; "soy alérgico al látex" → allergies (se agrega al listado previo); "cambié a GNP" → insurance.',
      parameters: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          email: { type: 'string' },
          birth_date: { type: 'string', description: 'YYYY-MM-DD' },
          allergies: { type: 'string', description: 'Si ya había, CONCATENAR (no sobrescribir). Ej si previo="nuez" y nuevo="látex" → "nuez, látex".' },
          chronic_conditions: { type: 'string' },
          current_medications: { type: 'string' },
          emergency_contact_name: { type: 'string' },
          emergency_contact_phone: { type: 'string' },
          insurance: { type: 'string', description: 'Ej: "IMSS", "GNP Seguros Médica", "Particular".' },
          address: { type: 'string' },
          city: { type: 'string' },
          family_history: { type: 'string', description: 'Historia familiar relevante. Ej: "madre con diabetes, padre con hipertensión".' },
          reason: { type: 'string', description: 'Por qué se actualiza (para audit). Ej: "paciente reportó alergia nueva durante agendamiento".' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = UpdateProfileArgs.parse(rawArgs);
    if (!ctx.contactId) return { updated: false, error: 'no contactId in ctx' };
    if (!(await assertContactBelongsToTenant(ctx.tenantId, ctx.contactId))) {
      return { updated: false, error: 'contact does not belong to tenant' };
    }

    // Traer intake_data previo para merge
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('intake_data')
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    const prevIntake = (existing?.intake_data as Record<string, unknown> | null) || {};

    const newIntakeFields: Record<string, unknown> = {
      allergies: args.allergies,
      chronic_conditions: args.chronic_conditions,
      current_medications: args.current_medications,
      emergency_contact_name: args.emergency_contact_name,
      emergency_contact_phone: args.emergency_contact_phone,
      insurance: args.insurance,
      family_history: args.family_history,
    };
    for (const k of Object.keys(newIntakeFields)) {
      if (newIntakeFields[k] === undefined) delete newIntakeFields[k];
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(newIntakeFields).length > 0) {
      update.intake_data = { ...prevIntake, ...newIntakeFields };
    }
    if (args.full_name) update.name = encryptPII(args.full_name.trim()) ?? args.full_name.trim();
    if (args.email) update.email = args.email;
    if (args.birth_date) update.birth_date = args.birth_date;
    if (args.address) update.address = args.address;
    if (args.city) update.city = args.city;

    if (Object.keys(update).length === 0) {
      return { updated: false, error: 'nothing to update' };
    }

    const { error } = await supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { updated: false, error: error.message };

    await logContactEvent({
      tenantId: ctx.tenantId,
      contactId: ctx.contactId,
      eventType: 'profile_updated',
      details: { fields_updated: Object.keys(update), reason: args.reason },
    });

    return { updated: true, fields_count: Object.keys(update).length };
  },
});

// ─── Tool 2: save_patient_document ──────────────────────────────────────────
// El paciente manda foto de receta / identificación / radiografía / INE.
// Guardamos la referencia (wa_media_id + descripción LLM) en contact_documents
// para que el dueño vea el historial en /contacts/[id]. La descarga real a
// Supabase Storage queda como TODO (requiere setup de bucket + RLS).
const SaveDocArgs = z
  .object({
    kind: z.enum([
      'prescription', 'identification', 'lab_result', 'radiograph',
      'insurance_card', 'selfie', 'other_image', 'other_pdf', 'audio_note',
    ]),
    wa_media_id: z.string().max(200).optional(),
    mime_type: z.string().max(100).optional(),
    size_bytes: z.number().int().min(0).optional(),
    description: z.string().max(2000),
    appointment_id: z.string().uuid().optional(),
  })
  .strict();

registerTool('save_patient_document', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_patient_document',
      description:
        'Persiste la referencia a un documento/imagen/audio que el paciente mandó por WhatsApp. Invocar cuando el mensaje entrante incluye media o la descripción generada por visión (`[IMAGEN ANALIZADA]`, `[PDF ...]`). El archivo en sí NO se descarga acá — solo guardamos el wa_media_id + la descripción.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['prescription', 'identification', 'lab_result', 'radiograph', 'insurance_card', 'selfie', 'other_image', 'other_pdf', 'audio_note'],
            description: 'Tipo inferido por el contenido: receta, identificación oficial, resultado de laboratorio, radiografía, credencial de seguro, selfie, otro imagen, otro PDF, nota de voz.',
          },
          wa_media_id: { type: 'string' },
          mime_type: { type: 'string' },
          size_bytes: { type: 'number' },
          description: { type: 'string', description: 'Descripción detallada del contenido (de la visión/transcripción). Ej: "receta manuscrita que indica amoxicilina 500mg cada 8h por 7 días".' },
          appointment_id: { type: 'string', description: 'UUID opcional si el documento está asociado a una cita específica.' },
        },
        required: ['kind', 'description'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SaveDocArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId in ctx' };
    if (!(await assertContactBelongsToTenant(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin
      .from('contact_documents')
      .insert({
        tenant_id: ctx.tenantId,
        contact_id: ctx.contactId,
        appointment_id: args.appointment_id ?? null,
        kind: args.kind,
        wa_media_id: args.wa_media_id ?? null,
        mime_type: args.mime_type ?? null,
        size_bytes: args.size_bytes ?? null,
        description: args.description,
      })
      .select('id')
      .single();

    if (error || !data) return { saved: false, error: error?.message };

    await logContactEvent({
      tenantId: ctx.tenantId,
      contactId: ctx.contactId,
      eventType: 'document_uploaded',
      details: { document_id: data.id, kind: args.kind },
    });

    return { saved: true, document_id: data.id as string, kind: args.kind };
  },
});

// ─── Tool 3: escalate_urgency ───────────────────────────────────────────────
// Paciente reporta algo grave ("dolor 10/10", "me está sangrando", "no puedo
// respirar"). Marcamos el contacto con emergency_flag, notificamos al dueño
// via WhatsApp, y el LLM responde al paciente con el teléfono de urgencias.
const UrgencyArgs = z
  .object({
    summary: z.string().min(5).max(500),
    severity: z.enum(['high', 'critical']),
  })
  .strict();

registerTool('escalate_urgency', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'escalate_urgency',
      description:
        'Invocar cuando el paciente reporta un síntoma grave o emergencia que no puede esperar a la cita. severity=critical para riesgo de vida (sangrado masivo, dolor de pecho, pérdida de conciencia, crisis mental). severity=high para dolor severo o síntoma que requiere consulta hoy/mañana pero no es vida-o-muerte. Notifica al dueño y marca al contacto con emergency_flag.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Resumen en 1-2 oraciones de lo que el paciente reportó, en sus palabras. Ej: "Paciente reporta dolor 10/10 en muela superior derecha desde hace 2 días, ya no puede comer."',
          },
          severity: {
            type: 'string',
            enum: ['high', 'critical'],
          },
        },
        required: ['summary', 'severity'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = UrgencyArgs.parse(rawArgs);

    // Marcar emergency_flag en contacts (solo si hay contactId y pertenece
    // al tenant del contexto). Si falla la assertion no abortamos el
    // escalate — la notificación al dueño SIEMPRE va, aunque no podamos
    // persistir el flag. Preferimos alertar sin data que no alertar.
    if (ctx.contactId && (await assertContactBelongsToTenant(ctx.tenantId, ctx.contactId))) {
      await supabaseAdmin
        .from('contacts')
        .update({
          emergency_flag: true,
          emergency_flag_at: new Date().toISOString(),
        })
        .eq('id', ctx.contactId)
        .eq('tenant_id', ctx.tenantId);

      await logContactEvent({
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        eventType: 'urgency_escalated',
        details: { severity: args.severity, summary: args.summary, phone: ctx.customerPhone },
      });
    }

    // Notificar al dueño inmediato
    const icon = args.severity === 'critical' ? '🚨' : '⚠️';
    const owner = await notifyOwner({
      tenantId: ctx.tenantId,
      event: 'complaint', // el enum más cercano a "urgencia"
      details: `${icon} URGENCIA ${args.severity.toUpperCase()}\n\nPaciente: ${ctx.customerName || 'sin nombre'} (${ctx.customerPhone})\n\n${args.summary}`,
    });

    return {
      escalated: true,
      owner_notified: owner.ok,
      severity: args.severity,
    };
  },
});

// ─── Tool 4: create_referred_contact ────────────────────────────────────────
// "Mi primo también quiere una cita" — crear un prospect con tracking de
// referral. El flujo: creamos el contact (sin conversation activa) y le
// mandamos un saludo opcional vía template (fuera de ventana 24h).
const ReferredArgs = z
  .object({
    referred_name: z.string().min(1).max(200),
    referred_phone: z.string().min(6).max(20),
    notes: z.string().max(500).optional(),
  })
  .strict();

registerTool('create_referred_contact', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'create_referred_contact',
      description:
        'Cuando el paciente dice que alguien más quiere agendar ("mi primo/hermana/amigo también quiere una cita"), crear ese prospect. Guarda nombre + teléfono + referred_by = el paciente actual. No manda mensaje automático al referido.',
      parameters: {
        type: 'object',
        properties: {
          referred_name: { type: 'string' },
          referred_phone: { type: 'string', description: 'Teléfono del referido, preferentemente E.164 (ej: +5219991234567).' },
          notes: { type: 'string', description: 'Opcional: qué servicio quiere, cualquier detalle que el paciente dio.' },
        },
        required: ['referred_name', 'referred_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ReferredArgs.parse(rawArgs);

    // Validar que el referrer (ctx.contactId) pertenece al tenant — si no,
    // rechazamos el create para evitar que un prompt injection pueda
    // referir pacientes cross-tenant. Si no hay contactId (ej. el flow
    // arrancó desde un canal sin conversation asociada), el referral se
    // crea sin referred_by.
    if (ctx.contactId && !(await assertContactBelongsToTenant(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'referrer contact does not belong to tenant' };
    }

    // Normalizar phone (reutilizar helper)
    const { normalizePhoneMx } = await import('@/lib/whatsapp/normalize-phone');
    const normalized = normalizePhoneMx(args.referred_phone);

    // Ver si ya existe el contacto (no duplicar)
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id, name')
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', normalized)
      .maybeSingle();

    if (existing) {
      return {
        created: false,
        existed: true,
        contact_id: existing.id as string,
        message: 'Ese teléfono ya existe como paciente.',
      };
    }

    const encName = encryptPII(args.referred_name.trim()) ?? args.referred_name.trim();

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        tenant_id: ctx.tenantId,
        phone: normalized,
        name: encName,
        referred_by: ctx.contactId || null,
        intake_data: args.notes ? { referral_note: args.notes } : {},
      })
      .select('id')
      .single();

    if (error || !data) return { created: false, error: error?.message };

    if (ctx.contactId) {
      await logContactEvent({
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        eventType: 'referral_created',
        details: { referred_contact_id: data.id, referred_name: args.referred_name },
      });
    }

    return { created: true, contact_id: data.id as string };
  },
});

// ─── Tool 5: save_patient_preferences ───────────────────────────────────────
// Preferencias de comunicación y UX. Vive en contacts.preferences JSONB.
// Los crons outbound (no-show-reminders, satisfaction-survey) deberían leerlas
// antes de enviar (TODO separado).
const PreferencesArgs = z
  .object({
    nickname: z.string().max(100).optional(),
    preferred_time_of_day: z.enum(['morning', 'afternoon', 'evening']).optional(),
    preferred_language: z.enum(['es', 'en']).optional(),
    no_morning_reminders: z.boolean().optional(),
    no_whatsapp_reminders: z.boolean().optional(),
    preferred_doctor_id: z.string().uuid().optional(),
    dont_call_me: z.boolean().optional(),
  })
  .strict();

registerTool('save_patient_preferences', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_patient_preferences',
      description:
        'Guarda preferencias de comunicación del paciente. Merge sobre lo previo. Ejemplos: "no me mandes recordatorios por la mañana" → no_morning_reminders=true; "prefiero que me llamen Pepe" → nickname="Pepe"; "prefiero citas en la tarde" → preferred_time_of_day="afternoon".',
      parameters: {
        type: 'object',
        properties: {
          nickname: { type: 'string', description: 'Cómo prefiere que lo llamen.' },
          preferred_time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
          preferred_language: { type: 'string', enum: ['es', 'en'] },
          no_morning_reminders: { type: 'boolean' },
          no_whatsapp_reminders: { type: 'boolean' },
          preferred_doctor_id: { type: 'string' },
          dont_call_me: { type: 'boolean', description: 'Paciente pide NO recibir llamadas de voz, solo WhatsApp.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = PreferencesArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId in ctx' };
    if (!(await assertContactBelongsToTenant(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('preferences')
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    const prev = (existing?.preferences as Record<string, unknown> | null) || {};

    const newPrefs: Record<string, unknown> = { ...args };
    for (const k of Object.keys(newPrefs)) {
      if (newPrefs[k] === undefined) delete newPrefs[k];
    }
    if (Object.keys(newPrefs).length === 0) {
      return { saved: false, error: 'no preferences provided' };
    }

    const merged = { ...prev, ...newPrefs };

    const { error } = await supabaseAdmin
      .from('contacts')
      .update({ preferences: merged })
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { saved: false, error: error.message };

    await logContactEvent({
      tenantId: ctx.tenantId,
      contactId: ctx.contactId,
      eventType: 'preference_saved',
      details: { keys: Object.keys(newPrefs) },
    });

    return { saved: true, keys_saved: Object.keys(newPrefs) };
  },
});
