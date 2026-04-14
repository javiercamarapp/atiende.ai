// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING PROMPT GENERATOR — Phase 3.C
// Genera prompts personalizados para todos los agentes de un nuevo tenant.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import type { AgentName } from '@/lib/agents/types';

export interface TenantOnboardingInput {
  tenantId: string;
  business_name: string;
  business_type: string;
  city: string;
  doctor_name: string;
  services: Array<{ name: string; price: number; duration: number }>;
  business_hours: Record<string, { open: string; close: string }>;
  tone: 'formal' | 'casual' | 'friendly';
  faq_answers: Record<string, string>;
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

/**
 * Llama al LLM para generar un prompt personalizado por cada agente del set.
 * Persiste cada uno en `tenant_prompts` con UPSERT por (tenant_id, agent_name).
 */
export async function generateAllAgentPrompts(
  input: TenantOnboardingInput,
): Promise<Record<AgentName, { prompt_text: string; model_used: string }>> {
  const result: Partial<Record<AgentName, { prompt_text: string; model_used: string }>> = {};

  for (const agent of AGENTS_TO_GENERATE) {
    const userPrompt = [
      `Genera un system prompt para el agente "${agent}" de una clínica mexicana.`,
      '',
      `Negocio: ${input.business_name}`,
      `Tipo: ${input.business_type}`,
      `Ciudad: ${input.city}`,
      `Doctor titular: ${input.doctor_name}`,
      `Tono: ${input.tone}`,
      `Servicios: ${input.services.map((s) => `${s.name} ($${s.price})`).join(', ')}`,
      '',
      'El prompt debe:',
      '- Personalizar con el nombre del negocio',
      '- Usar tono mexicano natural',
      '- Incluir reglas anti-alucinación',
      '- Definir el flujo del agente paso a paso',
      '- Listar las tools que el agente puede usar',
    ].join('\n');

    try {
      const r = await generateResponse({
        model: MODELS.GENERATOR,
        system:
          'Eres un experto en prompt engineering para agentes LLM en español mexicano. Generas system prompts claros, accionables, con reglas duras y ejemplos.',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4,
        maxTokens: 1500,
      });
      result[agent] = { prompt_text: r.text.trim(), model_used: r.model };
    } catch (err) {
      result[agent] = {
        prompt_text: `[Error generando prompt: ${err instanceof Error ? err.message : String(err)}]`,
        model_used: 'error',
      };
    }
  }

  return result as Record<AgentName, { prompt_text: string; model_used: string }>;
}

/** Persiste prompts generados en tenant_prompts (UPSERT por (tenant, agent)). */
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
