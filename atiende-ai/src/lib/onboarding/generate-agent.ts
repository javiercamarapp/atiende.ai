// Agent Generation — transforms onboarding answers into a fully configured AI agent
// Uses vertical metadata (FAQs, anti-hallucination rules, crisis protocols)

import { getVerticalMetadata, getVerticalQuestions, VERTICAL_NAMES } from '@/lib/verticals';
import type { VerticalEnum, VerticalMetadata } from '@/lib/verticals/types';

export interface AgentConfig {
  systemPrompt: string;
  verticalType: VerticalEnum;
  businessName: string;
  neverHallucinate: string[];
  crisisProtocols: string[];
  topFaqs: string[];
  answersRaw: Record<string, string>;
}

export function generateAgentConfig(
  vertical: VerticalEnum,
  answers: Record<string, string>,
  businessName: string,
): AgentConfig {
  const metadata = getVerticalMetadata(vertical);
  const questions = getVerticalQuestions(vertical);
  const displayName = VERTICAL_NAMES[vertical];

  // Build answers context
  const answersContext = questions
    .map((q, i) => {
      const key = `q${i + 1}`;
      const value = answers[key];
      if (!value) return null;
      return `- ${q.text}: ${value}`;
    })
    .filter(Boolean)
    .join('\n');

  const systemPrompt = buildSystemPrompt(
    displayName,
    businessName,
    answersContext,
    answers,
    metadata,
  );

  return {
    systemPrompt,
    verticalType: vertical,
    businessName,
    neverHallucinate: metadata?.neverHallucinate || [],
    crisisProtocols: metadata?.crisisProtocols || [],
    topFaqs: metadata?.topFaqs || [],
    answersRaw: answers,
  };
}

function buildSystemPrompt(
  verticalDisplayName: string,
  businessName: string,
  answersContext: string,
  answers: Record<string, string>,
  metadata?: VerticalMetadata,
): string {
  const neverRules = metadata?.neverHallucinate
    .map((r) => `- ${r}`)
    .join('\n') || '- No inventar informacion que no este en el contexto';

  const crisisRules = metadata?.crisisProtocols
    .map((r) => `- ${r}`)
    .join('\n') || '- Escalar a humano en situaciones criticas';

  const faqSection = metadata?.topFaqs
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n') || '';

  // Extract key fields from answers
  const address = answers['q2'] || '';
  const hours = answers['q3'] || '';
  const tone = answers['q26'] || answers['q21'] || answers['q14'] || answers['q15'] || 'profesional-cercano';
  const escalation = answers['q27'] || answers['q22'] || answers['q16'] || answers['q15'] || '';

  return `Eres el asistente virtual de ${businessName}, ${verticalDisplayName} ubicado en ${address}.

Tu tono es ${tone}.

INFORMACION VERIFICADA (UNICA fuente de verdad):
- Horario: ${hours}
${answersContext}

REGLAS ABSOLUTAS:
1. SI NO TIENES EL DATO EXACTO EN TU CONTEXTO, DI "Permitame verificar esa informacion con el equipo de ${businessName}. Te respondo en un momento."
2. NUNCA inventes precios, horarios, disponibilidad, citas/productos/servicios, ingredientes, ni diagnosticos.

REGLAS ANTI-ALUCINACION ESPECIFICAS:
${neverRules}

PROTOCOLOS DE CRISIS:
${crisisRules}

PREGUNTAS FRECUENTES (las mas comunes que hacen los clientes):
${faqSection}

ESCALACION A HUMANO:
- Cuando el cliente pida hablar con una persona
- Quejas no resueltas en 2 intentos
- Emergencias medicas/legales
- Cotizaciones complejas que requieren valoracion
- Contacto de escalacion: ${escalation}`;
}
