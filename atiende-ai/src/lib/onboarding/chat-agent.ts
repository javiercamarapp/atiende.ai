// Conversational onboarding agent.
// Wraps `generateStructured` with a vertical-aware system prompt that walks
// the agent through the schema conversationally (one field at a time, with
// soft re-asks for vague answers, URL-scrape context injection, etc).

import { z } from 'zod';
import {
  generateStructured,
  MODELS,
} from '@/lib/llm/openrouter';
import type { VerticalEnum } from '@/lib/verticals/types';
import { ALL_VERTICALS, VERTICAL_NAMES } from '@/lib/verticals';
import {
  buildFieldsBlock,
  getVerticalDisplayName,
  validKeysForVertical,
} from './vertical-schema-for-agent';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatAgentInput {
  vertical: VerticalEnum | null;
  capturedFields: Record<string, string>;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  /** Markdown extracted from a URL the user pasted in this turn (optional). */
  scrapedMarkdown?: string;
  /** Human-readable reason why the scrape failed (if applicable). */
  scrapeError?: string;
}

export interface ChatAgentResult {
  vertical: VerticalEnum | null;
  updatedFields: Record<string, string>;
  assistantMessage: string;
  done: boolean;
  /** If non-null, the agent chose to re-ask this field instead of filling it. */
  clarificationOf: string | null;
  cost: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

// Max turns of history included in the prompt to cap token growth.
const MAX_HISTORY_TURNS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const VerticalEnumSchema = z.enum(ALL_VERTICALS as [VerticalEnum, ...VerticalEnum[]]);

const AgentOutputSchema = z.object({
  vertical: z.union([VerticalEnumSchema, z.null()]),
  updatedFields: z.record(z.string(), z.string()),
  assistantMessage: z.string().min(1).max(1500),
  done: z.boolean(),
  clarificationOf: z.union([z.string(), z.null()]),
});

type AgentOutput = z.infer<typeof AgentOutputSchema>;

const VerticalDetectionSchema = z.object({
  vertical: z.union([VerticalEnumSchema, z.null()]),
  confidence: z.number().min(0).max(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildAgentSystemPrompt(
  vertical: VerticalEnum | null,
  capturedFields: Record<string, string>,
): string {
  const header = vertical
    ? `NEGOCIO DETECTADO: ${vertical} (${getVerticalDisplayName(vertical)})`
    : `NEGOCIO DETECTADO: todavía no identificado`;

  const fieldsBlock = vertical
    ? buildFieldsBlock(vertical, capturedFields)
    : '(cuando detectes el vertical, lista de campos aparecerá en el siguiente turno)';

  const verticalList = ALL_VERTICALS.join(', ');

  return `Eres el agente de pre-conversación de atiende.ai. Conoces el negocio del usuario mediante una charla natural, NO un cuestionario. Hablas español mexicano, cálido y breve (máximo 2 oraciones por turno, 1 idealmente).

${header}

TU OBJETIVO: capturar TODOS los campos marcados [REQ] en el schema de abajo. No marcas done=true hasta que cada campo [REQ] tenga valor concreto.

CAMPOS A CAPTURAR:
${fieldsBlock}

REGLAS DURAS:
1. Un solo tema por turno. No hagas preguntas dobles.
2. Si el usuario pega una URL, asume que nosotros ya procesamos su sitio; NO le pidas que la vuelva a mandar. Usa el contenido extraído (aparece abajo en "CONTENIDO DEL SITIO WEB") para llenar campos. SOLO llena campos con datos que aparezcan LITERALMENTE en el markdown. Si no están, pregunta normal.
3. Si una respuesta es vaga, evasiva o irrelevante ("no sé", "luego te digo", "lo que tú creas", "cualquier cosa"), NO la aceptes. Haz una re-pregunta amable y específica en assistantMessage, marca clarificationOf="qN", y NO incluyas ese campo en updatedFields en este turno.
4. Si el usuario da un dato que cubre varios campos en una sola frase (ej: "lunes a viernes 9 a 19 y cerramos domingos" llena horario + días de cierre), llena TODOS esos campos en updatedFields.
5. Prefiere siempre el siguiente campo [REQ] pendiente. Los opcionales [ ] los dejas para el final o los omites si el usuario parece con prisa.
6. Si vertical="todavía no identificado", tu primera tarea es inferirlo del mensaje del usuario (o del sitio scrapeado). Responde el enum exacto en el campo "vertical" del JSON y continúa la conversación asumiendo ese vertical. Si realmente no puedes inferirlo, pregunta en 1 oración qué tipo de negocio es.
7. Verticales válidos: ${verticalList}.
8. Cuando TODOS los [REQ] estén completos, responde done=true con un mensaje de cierre breve ("Listo, con esto armo tu agente").
9. Nunca inventes datos. Si no sabes algo, pregúntalo.
10. Nunca pidas datos que ya están en [YA CAPTURADO]. Continúa con el siguiente pendiente.

FORMATO DE RESPUESTA (JSON estricto, nada más):
{
  "vertical": "<enum del vertical o null si aún no sabes>",
  "updatedFields": { "qN": "valor", ... },
  "assistantMessage": "texto en español, 1-2 oraciones",
  "done": false,
  "clarificationOf": "qN o null"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation input builder
// ─────────────────────────────────────────────────────────────────────────────

function buildMessagesForAgent(input: ChatAgentInput): {
  role: 'user' | 'assistant';
  content: string;
}[] {
  const trimmed = input.history.slice(-MAX_HISTORY_TURNS);

  // Build the final user turn, with scraped markdown appended as a developer-style
  // appendix block if present. Jina Reader output is markdown, so we fence it.
  let finalUserContent = input.userMessage;

  if (input.scrapedMarkdown) {
    finalUserContent += `\n\n--- CONTENIDO DEL SITIO WEB DEL USUARIO (scraping automático) ---\n${input.scrapedMarkdown}\n--- FIN DEL CONTENIDO ---`;
  } else if (input.scrapeError) {
    finalUserContent += `\n\n(nota interna: intentamos abrir el link que pegó el usuario pero falló: ${input.scrapeError}. Pídele los datos a mano.)`;
  }

  // If the last history entry is already the same user message (edge case),
  // don't duplicate.
  const alreadyHasFinal =
    trimmed.length > 0 &&
    trimmed[trimmed.length - 1].role === 'user' &&
    trimmed[trimmed.length - 1].content === input.userMessage;

  if (alreadyHasFinal) {
    return [
      ...trimmed.slice(0, -1),
      { role: 'user', content: finalUserContent },
    ];
  }

  return [...trimmed, { role: 'user', content: finalUserContent }];
}

// ─────────────────────────────────────────────────────────────────────────────
// runChatAgent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one turn of the onboarding agent.
 * Filters updatedFields to only include keys valid for the detected vertical
 * (defense-in-depth against the model inventing keys).
 */
export async function runChatAgent(input: ChatAgentInput): Promise<ChatAgentResult> {
  const system = buildAgentSystemPrompt(input.vertical, input.capturedFields);
  const messages = buildMessagesForAgent(input);

  const result = await generateStructured<AgentOutput>({
    model: MODELS.ONBOARDING_AGENT,
    fallbackModel: MODELS.ONBOARDING_AGENT_FALLBACK,
    system,
    messages,
    schema: AgentOutputSchema,
    jsonSchemaName: 'OnboardingAgentTurn',
    maxTokens: 600,
    temperature: 0.3,
  });

  // Determine effective vertical (model may have just inferred it)
  const effectiveVertical: VerticalEnum | null = result.data.vertical ?? input.vertical;

  // Filter updatedFields to valid keys only
  let filteredFields: Record<string, string> = {};
  if (effectiveVertical) {
    const validKeys = validKeysForVertical(effectiveVertical);
    for (const [k, v] of Object.entries(result.data.updatedFields)) {
      if (validKeys.has(k) && typeof v === 'string' && v.trim().length > 0) {
        filteredFields[k] = v.trim();
      }
    }
  } else {
    // No vertical yet — drop any spurious fields
    filteredFields = {};
  }

  return {
    vertical: effectiveVertical,
    updatedFields: filteredFields,
    assistantMessage: result.data.assistantMessage,
    done: result.data.done,
    clarificationOf: result.data.clarificationOf,
    cost: result.cost,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detectVerticalFromContext — narrow structured call, used only when the
// route handler has no vertical yet and wants to pre-classify before running
// the main agent turn. Optional; `runChatAgent` can also infer inline.
// ─────────────────────────────────────────────────────────────────────────────

export async function detectVerticalFromContext(
  userText: string,
  scrapedMarkdown?: string,
): Promise<{ vertical: VerticalEnum | null; confidence: number }> {
  const verticalListForPrompt = ALL_VERTICALS.map(
    (v) => `${v} (${VERTICAL_NAMES[v]})`,
  ).join('\n');

  const system = `Eres un clasificador. Recibirás la descripción de un negocio (y posiblemente el contenido scrapeado de su sitio web). Responde con el enum exacto del vertical y un número de confianza entre 0 y 1.

Verticales disponibles:
${verticalListForPrompt}

Reglas:
- Responde "vertical": null si la confianza es menor a 0.6
- Responde con el enum exacto, no el display name
- JSON estricto:
{ "vertical": "<enum o null>", "confidence": 0.0-1.0 }`;

  const userContent = scrapedMarkdown
    ? `${userText}\n\n--- CONTENIDO DEL SITIO ---\n${scrapedMarkdown.slice(0, 8000)}\n---`
    : userText;

  const result = await generateStructured({
    model: MODELS.ONBOARDING_AGENT,
    fallbackModel: MODELS.ONBOARDING_AGENT_FALLBACK,
    system,
    messages: [{ role: 'user', content: userContent }],
    schema: VerticalDetectionSchema,
    jsonSchemaName: 'VerticalDetection',
    maxTokens: 100,
    temperature: 0.1,
  });

  return result.data;
}
