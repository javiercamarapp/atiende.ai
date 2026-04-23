import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ZONES,
  SHARED_SCHEDULE_QUESTIONS,
  SHARED_SERVICES_QUESTIONS,
  SHARED_TEAM_QUESTIONS,
  SHARED_LOCATION_QUESTIONS,
  SHARED_PAYMENTS_QUESTIONS,
  SHARED_POLICIES_QUESTIONS,
  SHARED_SPECIAL_QUESTIONS,
  SHARED_EXPERIENCE_QUESTIONS,
  SHARED_BRAND_QUESTIONS,
} from '@/lib/knowledge/zone-map';
import type { Question } from '@/lib/onboarding/questions';
import { logger } from '@/lib/logger';

const SHARED_BY_ZONE: Partial<Record<string, Question[]>> = {
  schedule: SHARED_SCHEDULE_QUESTIONS,
  services: SHARED_SERVICES_QUESTIONS,
  team: SHARED_TEAM_QUESTIONS,
  location: SHARED_LOCATION_QUESTIONS,
  payments: SHARED_PAYMENTS_QUESTIONS,
  policies: SHARED_POLICIES_QUESTIONS,
  special: SHARED_SPECIAL_QUESTIONS,
  experience: SHARED_EXPERIENCE_QUESTIONS,
  brand: SHARED_BRAND_QUESTIONS,
};

function answerText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(answerText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if ('value' in obj) return answerText(obj.value);
  }
  return '';
}

export function buildPromptFromResponses(
  tenantName: string,
  businessType: string,
  responses: Record<string, unknown>,
): string {
  const sections: string[] = [];

  for (const zone of ZONES) {
    const sharedQs = SHARED_BY_ZONE[zone.id] ?? [];
    const pairs: string[] = [];

    for (const q of sharedQs) {
      const val = answerText(responses[q.key]);
      if (val) pairs.push(`- ${q.label} ${val}`);
    }

    if (pairs.length > 0) {
      sections.push(`## ${zone.title}\n${pairs.join('\n')}`);
    }
  }

  const tone = answerText(responses.brand_tone) || answerText(responses.tone) || 'profesional y amigable';
  const botIntro = answerText(responses.brand_greeting) || answerText(responses.brand_bot_intro);
  const forbidden = answerText(responses.brand_forbidden) || answerText(responses.brand_forbidden_words);
  const complaints = answerText(responses.pol_complaints) || answerText(responses.brand_complaint_handling);

  let prompt = `Eres el asistente virtual de ${tenantName}.
Hablas espanol mexicano natural. Siempre tratas de "usted" al cliente.
Tu tono es: ${tone}.
`;

  if (botIntro) prompt += `Al iniciar una conversacion, presentate asi: "${botIntro}"\n`;
  if (forbidden) prompt += `NUNCA uses estas palabras o frases: ${forbidden}\n`;
  if (complaints) prompt += `Si el cliente se queja: ${complaints}\n`;

  prompt += `
Tu trabajo es:
- Informar sobre servicios, precios, horarios y ubicacion
- Agendar, confirmar y reprogramar citas
- Responder preguntas frecuentes con la informacion que tienes
- Si no sabes algo: "Permitame verificar con el equipo y le confirmo."
- NUNCA diagnostiques, recetes ni des asesoria medica/legal
- NUNCA inventes datos, precios ni horarios
- Ofrece siempre: "Si prefiere hablar con una persona, con gusto le comunico."

A continuacion tienes TODA la informacion de tu negocio. Usa SOLO esto para responder:

${sections.join('\n\n')}`;

  return prompt;
}

export async function regeneratePrompt(tenantId: string): Promise<void> {
  const log = logger.child({ helper: 'regeneratePrompt', tenant_id: tenantId });

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, business_type')
    .eq('id', tenantId)
    .single();

  if (!tenant) {
    log.warn('Tenant not found, skipping prompt regeneration');
    return;
  }

  const { data: onbResponses } = await supabaseAdmin
    .from('onboarding_responses')
    .select('question_key, answer')
    .eq('tenant_id', tenantId);

  const responses: Record<string, unknown> = {};
  for (const r of (onbResponses || []) as { question_key: string; answer: unknown }[]) {
    const val = r.answer;
    if (typeof val === 'object' && val !== null && 'text' in (val as Record<string, unknown>)) {
      responses[r.question_key] = (val as Record<string, unknown>).text;
    } else if (typeof val === 'object' && val !== null && 'value' in (val as Record<string, unknown>)) {
      responses[r.question_key] = (val as Record<string, unknown>).value;
    } else {
      responses[r.question_key] = val;
    }
  }

  const prompt = buildPromptFromResponses(
    tenant.name as string,
    tenant.business_type as string,
    responses,
  );

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({ chat_system_prompt: prompt })
    .eq('id', tenantId);

  if (error) {
    log.error('Failed to update chat_system_prompt', new Error(error.message));
  } else {
    log.info('System prompt regenerated', { length: prompt.length });
  }
}
