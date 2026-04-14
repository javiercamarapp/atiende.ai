// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING PROMPT GENERATOR — Phase 3.C / 7.A
// Genera system prompts personalizados para todos los agentes de un nuevo tenant.
// Modelo designado: qwen/qwen3.6-plus (fuerte en instrucciones largas + español).
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import type { AgentName } from '@/lib/agents/types';

// ─────────────────────────────────────────────────────────────────────────────
// Modelo designado para generación de prompts. Si falla, cae a GENERATOR.
// ─────────────────────────────────────────────────────────────────────────────
const PROMPT_GEN_MODEL = 'qwen/qwen3.6-plus';
const PROMPT_GEN_FALLBACK = MODELS.GENERATOR; // google/gemini-2.5-flash

export interface TenantOnboardingInput {
  tenantId: string;
  business_name: string;
  business_type: string;
  city: string;
  doctor_name: string;
  services: Array<{ name: string; price: number; duration: number }>;
  business_hours: Record<string, { open: string; close: string } | string>;
  tone: 'formal' | 'casual' | 'friendly';
  faqs?: Record<string, string>;
  /** Alias de compatibilidad con callers que usan faq_answers. */
  faq_answers?: Record<string, string>;
}

const AGENTS_TO_GENERATE: AgentName[] = [
  'orchestrator',
  'agenda',
  'intake',
  'no-show',
  'post-consulta',
  'retencion',
  'triaje',
];

// ─────────────────────────────────────────────────────────────────────────────
// Instrucciones por agente — briefing específico que se concatena al prompt base
// ─────────────────────────────────────────────────────────────────────────────
const AGENT_BRIEFS: Record<AgentName, string> = {
  orchestrator:
    'Rutea mensajes al sub-agente correcto (agenda, intake, triaje, etc.). NO resuelve consultas por sí mismo — solo clasifica y delega. Debe reconocer urgencias médicas y saludos.',
  agenda:
    'Agenda, modifica, cancela y consulta citas. Usa tools: check_availability, book_appointment, get_my_appointments, modify_appointment, cancel_appointment. Confirma horario antes de reservar.',
  intake:
    'Recopila historia médica básica del paciente nuevo: antecedentes, alergias, medicamentos actuales, motivo de consulta. Nunca da consejo médico.',
  'no-show':
    'Worker autónomo: envía recordatorios de confirmación 24h antes de citas. No conversa — es batch worker.',
  'post-consulta':
    'Envía instrucciones post-visita (ayuno, cuidados, medicamentos). Dispara seguimiento + cobranza si hay pago pendiente.',
  retencion:
    'Reactiva pacientes con >90 días sin visita. Genera mensajes personalizados (no plantillas) basados en historial.',
  triaje:
    'Pre-consulta médica. Hace preguntas clínicas estructuradas para estimar urgencia: 1 (emergencia)…4 (no urgente). Nunca da diagnóstico.',
  faq: '',
  'agenda-gap': '',
  reputacion: '',
  cobranza: '',
  encuesta: '',
  medicamento: '',
};

const TONE_GUIDE: Record<TenantOnboardingInput['tone'], string> = {
  formal: 'Usa "usted", trato respetuoso y profesional. Cero emojis.',
  casual: 'Usa "tú" con cercanía. Emojis ocasionales (máx 1 por mensaje).',
  friendly: 'Cálido pero profesional. "Tú" con tono servicial. Emojis apropiados (máx 2).',
};

function formatHours(h: TenantOnboardingInput['business_hours']): string {
  const days: Record<string, string> = {
    mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom',
  };
  return Object.entries(h)
    .map(([day, v]) => {
      const label = days[day] || day;
      if (typeof v === 'string') return `${label}: ${v}`;
      if (v && typeof v === 'object' && 'open' in v) return `${label}: ${v.open}-${v.close}`;
      return `${label}: cerrado`;
    })
    .join(', ');
}

function formatFAQs(faqs: Record<string, string> | undefined): string {
  if (!faqs || Object.keys(faqs).length === 0) return 'Sin FAQs cargadas';
  return Object.entries(faqs)
    .slice(0, 10)
    .map(([q, a]) => `  P: ${q}\n  R: ${a}`)
    .join('\n\n');
}

/**
 * Genera un prompt personalizado por agente. Intenta primero con
 * qwen/qwen3.6-plus; cae a GENERATOR si el modelo falla.
 */
export async function generateAllAgentPrompts(
  input: TenantOnboardingInput,
): Promise<Record<AgentName, { prompt_text: string; model_used: string }>> {
  const faqs = input.faqs || input.faq_answers || {};
  const hoursStr = formatHours(input.business_hours || {});
  const servicesStr = input.services.length > 0
    ? input.services.map((s) => `  - ${s.name}: $${s.price} MXN (${s.duration} min)`).join('\n')
    : '  (sin servicios cargados)';

  const result: Partial<Record<AgentName, { prompt_text: string; model_used: string }>> = {};

  for (const agent of AGENTS_TO_GENERATE) {
    const brief = AGENT_BRIEFS[agent] || '';
    const userPrompt = [
      `Genera el system prompt para el agente "${agent}" de un consultorio mexicano.`,
      '',
      `ROL DEL AGENTE:`,
      brief,
      '',
      `═══ DATOS DEL NEGOCIO ═══`,
      `Nombre: ${input.business_name}`,
      `Tipo: ${input.business_type}`,
      `Ciudad: ${input.city}, México`,
      `Doctor titular: ${input.doctor_name || '(no especificado)'}`,
      `Tono: ${input.tone} — ${TONE_GUIDE[input.tone]}`,
      '',
      `═══ SERVICIOS Y PRECIOS ═══`,
      servicesStr,
      '',
      `═══ HORARIOS ═══`,
      hoursStr,
      '',
      `═══ FAQs ═══`,
      formatFAQs(faqs),
      '',
      `═══ REQUISITOS DEL PROMPT ═══`,
      `- Integra el nombre del negocio, la ciudad y el tono de forma natural.`,
      `- Incluye reglas anti-alucinación: "Solo menciona precios exactos listados arriba."`,
      `- Incluye reglas de escalación: cuándo derivar a humano.`,
      `- Define el flujo paso a paso (numerado).`,
      `- Lista las tools que el agente tiene disponibles (si aplica).`,
      `- Español mexicano neutro. Sin modismos.`,
      `- Longitud objetivo: 500-1200 palabras.`,
      `- Responde SOLO el prompt. Sin meta-explicaciones ni markdown wrapper.`,
    ].join('\n');

    let text = '';
    let modelUsed = '';
    try {
      const r = await generateResponse({
        model: PROMPT_GEN_MODEL,
        system:
          'Eres un experto senior en prompt engineering para agentes LLM en español mexicano. Generas system prompts claros, accionables, con reglas duras, ejemplos y guardrails. Nunca inventas datos que no te dieron.',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4,
        maxTokens: 2000,
      });
      text = r.text.trim();
      modelUsed = r.model;
    } catch (primaryErr) {
      console.warn(`[onboarding-prompt] ${PROMPT_GEN_MODEL} failed for ${agent}, trying fallback:`, primaryErr);
      try {
        const r = await generateResponse({
          model: PROMPT_GEN_FALLBACK,
          system:
            'Eres un experto senior en prompt engineering para agentes LLM en español mexicano.',
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.4,
          maxTokens: 2000,
        });
        text = r.text.trim();
        modelUsed = r.model;
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        text = `[Error generando prompt para ${agent}: ${msg}]`;
        modelUsed = 'error';
      }
    }

    result[agent] = { prompt_text: text, model_used: modelUsed };
  }

  return result as Record<AgentName, { prompt_text: string; model_used: string }>;
}

/**
 * Persiste prompts generados en tenant_prompts (UPSERT por (tenant, agent)).
 */
export async function saveTenantPrompts(opts: {
  tenantId: string;
  prompts: Record<string, { prompt_text: string; model_used: string }>;
}): Promise<{ saved: number; errors: number }> {
  const rows = Object.entries(opts.prompts).map(([agent_name, p]) => ({
    tenant_id: opts.tenantId,
    agent_name,
    prompt_text: p.prompt_text,
    model_used: p.model_used,
    is_active: true,
    generated_at: new Date().toISOString(),
  }));

  let saved = 0;
  let errors = 0;
  for (const row of rows) {
    const { error } = await supabaseAdmin
      .from('tenant_prompts')
      .upsert(row, { onConflict: 'tenant_id,agent_name' });
    if (error) errors++;
    else saved++;
  }
  return { saved, errors };
}

/**
 * Helper end-to-end: genera + guarda. Pensado para llamarse desde el flujo
 * de onboarding como fire-and-forget (no bloquea la respuesta al cliente).
 */
export async function generateAndSaveAllAgentPrompts(
  input: TenantOnboardingInput,
): Promise<{ success: boolean; prompts_generated: number; errors: number }> {
  try {
    const prompts = await generateAllAgentPrompts(input);
    const { saved, errors } = await saveTenantPrompts({
      tenantId: input.tenantId,
      prompts,
    });
    return { success: errors === 0, prompts_generated: saved, errors };
  } catch (err) {
    console.error('[onboarding-prompt] generateAndSaveAllAgentPrompts failed:', err);
    return { success: false, prompts_generated: 0, errors: 1 };
  }
}
