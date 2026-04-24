// ═════════════════════════════════════════════════════════════════════════════
// CONVERSION + COMPLIANCE TOOLS (Phase 1)
//
// Cinco tools que cubren las conversaciones que actualmente los pacientes
// hacen y se pierden en el bot:
//
//   1. get_service_quote          — cotización de servicios y paquetes
//   2. save_patient_guardian      — tutor legal para menores
//   3. validate_minor_permission  — chequea si paciente <18 y si hay consent
//   4. retrieve_doctor_expertise  — bio/especialidades del staff
//   5. capture_marketing_source   — UTM/source tracking para ROI marketing
//
// Todos son shared: registrados en agenda e intake. Las read-only no
// necesitan validación cross-tenant (solo exponen data del tenant actual);
// las write validan que el contact_id pertenece al tenant (helper
// assertContactBelongsToTenant importado de profile-tools).
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { trackError } from '@/lib/monitoring';

// Helper inline — profile-tools exporta internamente pero no re-exporta.
// Duplicamos acá (barato, 10 líneas) para evitar cyclic import entre los
// dos shared files.
async function assertContact(tenantId: string, contactId: string): Promise<boolean> {
  if (!tenantId || !contactId) return false;
  const { data } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!data) {
    trackError('conversion_tool_cross_tenant_blocked');
    return false;
  }
  return true;
}

// ─── Tool 1: get_service_quote ──────────────────────────────────────────────
// Lee el catálogo de servicios y devuelve detalles (precio + duración + desc)
// matcheados por keywords. El paciente pregunta "¿cuánto cuesta limpieza +
// blanqueamiento?" — el LLM invoca esto para armar la cotización correcta
// sin inventar precios. Respeta el guardrail de precios (no aluciar).
const QuoteArgs = z
  .object({
    service_keywords: z
      .array(z.string().min(2).max(100))
      .min(1)
      .max(5),
  })
  .strict();

registerTool('get_service_quote', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_service_quote',
      description:
        'Busca servicios en el catálogo por palabras clave y devuelve precio + duración + descripción. Usar cuando el paciente pregunta por costo o paquete ("¿cuánto cuesta limpieza?"). NO inventes precios — si la búsqueda no matchea, respondé "permítame verificar con el equipo".',
      parameters: {
        type: 'object',
        properties: {
          service_keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Hasta 5 keywords del servicio. Ej: ["limpieza", "blanqueamiento"]. Case-insensitive, sin acentos.',
          },
        },
        required: ['service_keywords'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = QuoteArgs.parse(rawArgs);

    const { data: services, error } = await supabaseAdmin
      .from('services')
      .select('id, name, description, price, duration_minutes, category')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    if (error) return { matches: [], error: error.message };

    // Match inline: lowercase + strip acentos + substring.
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const keywordsNorm = args.service_keywords.map(norm);

    const matches = (services || [])
      .filter((s) => {
        const hay = `${norm(s.name)} ${norm(s.description || '')} ${norm(s.category || '')}`;
        return keywordsNorm.some((kw) => hay.includes(kw));
      })
      .map((s) => ({
        id: s.id,
        name: s.name,
        price_mxn: s.price ? Number(s.price) : null,
        duration_minutes: s.duration_minutes ?? 30,
        description: s.description ?? null,
      }));

    // Total estimado si el paciente pidió varios (keywords matchearon varios)
    const priced = matches.filter((m) => typeof m.price_mxn === 'number');
    const totalEstimate =
      priced.length > 1
        ? priced.reduce((acc, m) => acc + (m.price_mxn as number), 0)
        : null;

    return {
      matches,
      total_estimate_mxn: totalEstimate,
      not_found_keywords: keywordsNorm.filter(
        (kw) =>
          !matches.some((m) =>
            `${norm(m.name)} ${norm(m.description || '')}`.includes(kw),
          ),
      ),
    };
  },
});

// ─── Tool 2: save_patient_guardian ──────────────────────────────────────────
// Paciente menor de edad → tutor legal. Guarda nombre + tel + relación en
// contacts. También marca guardian_consent_at si el LLM confirmó que el
// tutor dio consentimiento verbal (anota el timestamp para auditoría).
const GuardianArgs = z
  .object({
    guardian_name: z.string().min(2).max(200),
    guardian_phone: z.string().min(6).max(20),
    relation: z.enum(['padre', 'madre', 'tutor', 'abuelo', 'tio', 'otro']),
    consent_given: z.boolean().optional(),
  })
  .strict();

registerTool('save_patient_guardian', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_patient_guardian',
      description:
        'Cuando el paciente es menor (o cuando otra persona agenda por él), registra el tutor legal. Usar si la conversación menciona "mi hijo de X años", "para mi papá", etc. consent_given=true si el tutor explícitamente dio autorización para el tratamiento en la conversación.',
      parameters: {
        type: 'object',
        properties: {
          guardian_name: { type: 'string' },
          guardian_phone: { type: 'string' },
          relation: {
            type: 'string',
            enum: ['padre', 'madre', 'tutor', 'abuelo', 'tio', 'otro'],
          },
          consent_given: {
            type: 'boolean',
            description: 'True si el tutor DIJO "sí autorizo/doy permiso" en la conversación.',
          },
        },
        required: ['guardian_name', 'guardian_phone', 'relation'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GuardianArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId in ctx' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    const update: Record<string, unknown> = {
      guardian_name: args.guardian_name.trim(),
      guardian_phone: args.guardian_phone.trim(),
      guardian_relation: args.relation,
    };
    if (args.consent_given) {
      update.guardian_consent_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { saved: false, error: error.message };
    return { saved: true, consent_recorded: Boolean(args.consent_given) };
  },
});

// ─── Tool 3: validate_minor_permission ──────────────────────────────────────
// Lee si el paciente es menor (columna generada is_minor desde birth_date) y
// si tiene guardian_consent_at. Retorna decisión: can_proceed / needs_consent /
// unknown_age. El agente decide qué decirle al paciente.
const ValidateMinorArgs = z.object({}).strict();

registerTool('validate_minor_permission', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'validate_minor_permission',
      description:
        'Antes de agendar procedimientos a un menor, llamá este tool para chequear si tenés edad registrada y consentimiento del tutor. Retorna {is_minor, has_consent, can_proceed, reason}. Si unknown_age, preguntale la edad; si needs_consent, pedí datos del tutor con save_patient_guardian.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_rawArgs: unknown, ctx: ToolContext) => {
    if (!ctx.contactId) return { can_proceed: false, reason: 'no contactId' };
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('birth_date, guardian_consent_at, guardian_name')
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (!data) return { can_proceed: false, reason: 'contact not found' };

    if (data.birth_date == null) {
      return {
        is_minor: null,
        has_consent: false,
        can_proceed: false,
        reason: 'unknown_age',
        next_step: 'Preguntá la fecha de nacimiento del paciente antes de seguir.',
      };
    }

    // Calculamos is_minor on-demand (no podemos usar GENERATED column con
    // CURRENT_DATE en Postgres — IMMUTABLE requirement). La lógica es la
    // canónica de edad: hoy - birth_date ≥ 18 años.
    const birth = new Date(data.birth_date as string);
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    const isMinor = birth > eighteenYearsAgo;

    if (!isMinor) {
      return { is_minor: false, has_consent: true, can_proceed: true, reason: 'adult' };
    }
    const hasConsent = Boolean(data.guardian_consent_at && data.guardian_name);
    return {
      is_minor: true,
      has_consent: hasConsent,
      can_proceed: hasConsent,
      reason: hasConsent ? 'minor_with_consent' : 'needs_consent',
      next_step: hasConsent
        ? null
        : 'Pedí nombre + teléfono del tutor legal y confirmación de consentimiento; llamá save_patient_guardian({..., consent_given: true}).',
    };
  },
});

// ─── Tool 4: retrieve_doctor_expertise ──────────────────────────────────────
// Paciente pregunta "¿tiene experiencia con implantes?". Busca staff activo
// cuyo bio/procedures/speciality matchee el keyword. Retorna hasta 3 matches
// con bio, años de experiencia, certificaciones.
const ExpertiseArgs = z
  .object({
    keyword: z.string().min(2).max(120),
    staff_id: z.string().uuid().optional(),
  })
  .strict();

registerTool('retrieve_doctor_expertise', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'retrieve_doctor_expertise',
      description:
        'Cuando el paciente pregunta por experiencia del doctor ("¿tiene casos de All-on-4?", "¿es especialista en ortodoncia?"), buscá en bio/procedures/speciality del staff activo. Devuelve hasta 3 matches con bio + años experiencia + certificaciones. Si no hay match, el agente responde "nuestro equipo tiene experiencia general; ¿le agendo una valoración?".',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'El término específico que preguntó el paciente. Ej: "implantes", "ortodoncia invisible", "endodoncia".' },
          staff_id: { type: 'string', description: 'Opcional: UUID de un doctor específico para buscar solo su bio.' },
        },
        required: ['keyword'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ExpertiseArgs.parse(rawArgs);

    let query = supabaseAdmin
      .from('staff')
      .select('id, name, role, speciality, bio, certifications, experience_years, procedures')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    if (args.staff_id) query = query.eq('id', args.staff_id);

    const { data: staff, error } = await query;
    if (error) return { matches: [], error: error.message };

    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const kw = norm(args.keyword);

    const matches = (staff || [])
      .map((s) => {
        const haystack = [
          s.speciality || '',
          s.bio || '',
          (s.procedures || []).join(' '),
          s.role || '',
        ]
          .map(norm)
          .join(' ');
        const score = haystack.includes(kw) ? 1 : 0;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .slice(0, 3)
      .map((x) => ({
        id: x.s.id,
        name: x.s.name,
        speciality: x.s.speciality,
        bio: x.s.bio,
        experience_years: x.s.experience_years,
        certifications: x.s.certifications,
        procedures: x.s.procedures,
      }));

    return { matches, keyword_searched: args.keyword };
  },
});

// ─── Tool 5: capture_marketing_source ───────────────────────────────────────
// Cuando el paciente menciona cómo llegó ("vi un anuncio en Instagram",
// "me recomendó mi primo", "Google"), guardamos el source + campaign si
// hay para que marketing pueda medir ROI. Solo se setea la primera vez;
// subsecuentes calls NO sobrescriben (preserve first-touch attribution).
const MarketingSourceArgs = z
  .object({
    source: z.enum([
      'instagram', 'facebook', 'google', 'tiktok', 'referral',
      'whatsapp_direct', 'signage', 'word_of_mouth', 'other',
    ]),
    utm_campaign: z.string().max(200).optional(),
    utm_medium: z.string().max(100).optional(),
    utm_content: z.string().max(200).optional(),
  })
  .strict();

registerTool('capture_marketing_source', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'capture_marketing_source',
      description:
        'Cuando el paciente menciona CÓMO llegó al consultorio ("vi anuncio en Instagram", "Google", "mi primo me recomendó"), llamá este tool. Solo preserva first-touch: si ya había un source registrado, NO se sobrescribe. Permite medir ROI de campañas. Usar early en la conversación — una sola vez por paciente.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['instagram', 'facebook', 'google', 'tiktok', 'referral', 'whatsapp_direct', 'signage', 'word_of_mouth', 'other'],
          },
          utm_campaign: { type: 'string', description: 'Si el paciente menciona nombre de promo/campaña (ej: "promoción de verano").' },
          utm_medium: { type: 'string', description: 'Si se puede inferir: "cpc" / "social" / "organic".' },
          utm_content: { type: 'string', description: 'Ej: "anuncio de blanqueamiento" / "post de paciente".' },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarketingSourceArgs.parse(rawArgs);
    if (!ctx.contactId) return { saved: false, error: 'no contactId in ctx' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { saved: false, error: 'contact does not belong to tenant' };
    }

    // First-touch: solo setear si el campo está vacío.
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('marketing_source')
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (existing?.marketing_source) {
      return {
        saved: false,
        already_set: existing.marketing_source,
        message: 'first-touch preservado, no se sobrescribe',
      };
    }

    const update: Record<string, unknown> = { marketing_source: args.source };
    if (args.utm_campaign) update.utm_campaign = args.utm_campaign;
    if (args.utm_medium) update.utm_medium = args.utm_medium;
    if (args.utm_content) update.utm_content = args.utm_content;

    const { error } = await supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { saved: false, error: error.message };
    return { saved: true, source: args.source };
  },
});
