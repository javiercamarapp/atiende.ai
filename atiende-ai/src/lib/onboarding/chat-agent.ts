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

export interface UploadedContentItem {
  /** Original filename as provided by the user. */
  filename: string;
  /** Markdown extracted from the upload (e.g. menu, price list, cedula). */
  markdown: string;
}

export interface ChatAgentInput {
  vertical: VerticalEnum | null;
  capturedFields: Record<string, string>;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  /** Markdown extracted from a URL the user pasted in this turn (optional). */
  scrapedMarkdown?: string;
  /** Human-readable reason why the scrape failed (if applicable). */
  scrapeError?: string;
  /** Content already extracted from files the user uploaded in this turn. */
  uploadedContent?: UploadedContentItem[];
}

export interface ChatAgentResult {
  vertical: VerticalEnum | 'waitlist' | null;
  updatedFields: Record<string, string>;
  /**
   * One-to-three sequential messages the client should render as separate
   * bubbles with short pauses between them. Lets the agent acknowledge a
   * scrape/upload in one bubble and follow up with the next question in a
   * second bubble — without needing the user to send a new message first.
   */
  assistantMessages: string[];
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

// The agent can also return "waitlist" for unsupported verticals
const AgentVerticalSchema = z.union([
  VerticalEnumSchema,
  z.literal('waitlist'),
  z.null(),
]);

const AgentOutputSchema = z.object({
  vertical: AgentVerticalSchema,
  updatedFields: z.record(z.string(), z.string()),
  assistantMessages: z.array(z.string().min(1).max(800)).min(1).max(3),
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

  return `Eres el agente de pre-conversación de atiende.ai. Conoces el negocio del usuario mediante una charla natural, NO un cuestionario. Hablas español mexicano, cálido y breve.

${header}

TU OBJETIVO: capturar TODOS los campos marcados [REQ] en el schema de abajo. No marcas done=true hasta que cada campo [REQ] tenga valor concreto.

CAMPOS A CAPTURAR:
${fieldsBlock}

REGLAS DURAS:
1. REGLA MÁS IMPORTANTE — SIEMPRE RESPONDE Y SIEMPRE AVANZA. Mientras el onboarding no esté terminado (done=false), tu respuesta SIEMPRE debe incluir la siguiente pregunta o acción. NUNCA te quedes callado. NUNCA dejes un mensaje sin responder. NUNCA respondas SOLO con un acuse ("Perfecto", "Anotado", "Genial"). Cada turno DEBE terminar con la siguiente pregunta pendiente. Si el usuario dice algo raro, off-topic, o incomprensible, reconócelo amablemente y vuelve al siguiente campo pendiente. NO HAY EXCUSA para no responder — el usuario NUNCA debe sentir que el bot se trabó o dejó de funcionar.
2. Un solo tema por turno. No hagas preguntas dobles, pero SÍ puedes (y debes) combinar un acuse corto + una pregunta nueva en el mismo turno.
3. Si el usuario pega una URL, asume que nosotros ya procesamos su sitio; NO le pidas que la vuelva a mandar. Usa el contenido extraído (aparece abajo en "CONTENIDO DEL SITIO WEB") para llenar campos. SOLO llena campos con datos que aparezcan LITERALMENTE en el markdown. Si no están, pregunta normal.
4. Si el usuario sube archivos o imágenes (menús, listas de precios, fotos de cédulas, logos, cartas), aparecerán abajo como "ARCHIVO SUBIDO POR EL USUARIO". Ya fueron procesados con visión; NO pidas que los vuelva a mandar. SOLO llena campos con datos que aparezcan LITERALMENTE en la extracción del archivo. Agradece que los haya mandado.
5. RECHAZOS Y CAMPOS OPCIONALES:
   - Si el usuario dice "no quiero", "no", "paso", "skip", "prefiero no", "no te voy a dar eso", o cualquier variante de RECHAZO:
     a) Si el campo es OPCIONAL [   ] → responde "Sin problema, es opcional" y avanza INMEDIATAMENTE al siguiente campo. NO re-preguntes. NO insistas.
     b) Si el campo es REQUERIDO [REQ] → di amablemente que es útil pero NO bloquees. Ej: "Entiendo. Es útil para que el bot responda mejor, pero si prefieres no compartirlo por ahora podemos seguir. ¿Me dices [siguiente campo]?" y avanza.
   - NUNCA re-preguntes algo que el usuario rechazó explícitamente. Una vez que dice "no", ese campo se salta para siempre.
   - Respuestas vagas ("no sé", "luego te digo", "lo que tú creas") SÍ ameritan una re-pregunta amable. Pero "no quiero" NO es vago — es una decisión clara.
5b. CAMPOS REQUERIDOS IGNORADOS O INCOMPLETOS:
   - Si preguntaste un campo [REQ] y el usuario cambió de tema, ignoró la pregunta, o dio una respuesta que NO contiene la info que necesitas → NO marques ese campo como capturado en updatedFields.
   - Antes de marcar done=true, REVISA el schema completo. Si hay campos [REQ] sin [YA CAPTURADO], vuelve a preguntarlos ANTES de terminar.
   - Ejemplo: si preguntaste "¿Emiten factura?" y el usuario dijo "sí" pero no dio RFC ni datos → el campo queda incompleto. Vuelve a él después: "Perfecto que emiten factura. ¿Qué datos necesitan del paciente? (RFC, régimen fiscal, uso CFDI)"
   - NO dejes pasar respuestas como "todos", "cualquiera", "lo normal" para campos que necesitan datos específicos (precios, horarios, servicios). Re-pregunta con ejemplos concretos.
6. Si el usuario da un dato que cubre varios campos en una sola frase (ej: "lunes a viernes 9 a 19 y cerramos domingos" llena horario + días de cierre), llena TODOS esos campos en updatedFields.
7. Los campos OPCIONALES [   ] son exactamente eso: opcionales. NO los trates como requeridos. Si estás en un campo opcional y el usuario no responde o dice que no, sáltalo sin drama y ve al siguiente [REQ]. El onboarding debe ser RÁPIDO — pregunta solo lo esencial y avanza.
8. VERTICALES ACTIVAS — aceptamos 2 tipos de servicio:
   TIPO CITAS (agendar citas): dental, medico, nutriologa, psicologo, dermatologo, ginecologo, pediatra, oftalmologo, farmacia, veterinaria, salon_belleza, barberia, spa, gimnasio, nail_salon, estetica — cualquier negocio de SALUD o BELLEZA que trabaje con citas.
   TIPO PEDIDOS (tomar pedidos): restaurante, taqueria, cafeteria, panaderia, bar_cantina, food_truck — cualquier negocio de COMIDA.
   Si el usuario describe un negocio de salud, belleza o comida → clasifícalo con el enum correcto de la lista.
   Si describe CUALQUIER OTRO tipo (hotel, tienda de ropa, inmobiliaria, escuela, taller mecánico, etc.) → responde vertical="waitlist" y un mensaje amable: "¡Gracias por tu interés! Por ahora trabajamos con negocios de salud, belleza y restaurantes. Déjame tu correo y te aviso cuando abramos tu tipo de negocio."
9. Si vertical="todavía no identificado", infiere del mensaje: salud/belleza → enum correspondiente, comida → enum correspondiente, otro → "waitlist" (pide email).
10. ANTES de marcar done=true, revisa TODOS los campos [REQ] en el schema. Si hay alguno que NO tiene [YA CAPTURADO] y el usuario NO lo rechazó explícitamente, pregúntalo AHORA en vez de terminar. Solo marca done=true cuando genuinamente todos los [REQ] estén capturados (o explícitamente rechazados por el usuario). Cuando todo esté completo, responde done=true con un mensaje de cierre breve. Este es el ÚNICO caso donde puedes no incluir pregunta.
11. Nunca inventes datos. Si no sabes algo, pregúntalo. Cuando tengas duda entre "subir un archivo" y "escribirlo a mano", sugiere subir (ej: "¿tienes tu menú en foto? Puedes subirla y la leo").
12. Nunca pidas datos que ya están en [YA CAPTURADO]. Continúa con el siguiente pendiente.
13. CHAT REAL: el usuario puede mandar varios mensajes seguidos sin esperar tu respuesta (como un chat de WhatsApp). Si en el historial ves varios mensajes "user" consecutivos antes de tu turno, trata TODA esa secuencia como contexto — extrae toda la info posible de TODOS esos mensajes y responde al bloque completo con un solo set de updatedFields.

REGLA CLAVE — MENSAJES EN SECUENCIA (assistantMessages):
El campo "assistantMessages" es un array de 1 a 3 mensajes que el cliente renderiza como burbujas separadas con pausas cortas entre ellas. Úsalo así:

- Casos de 2-3 mensajes (preferente):
  a) Cuando el usuario acaba de pegar una URL o subir un archivo y extrajimos info: primer mensaje corto reconociendo ("Perfecto, vi tu sitio ✨ Encontré dirección, horario y teléfono."), segundo mensaje con la siguiente pregunta natural ("¿Me confirmas si también ofrecen servicio a domicilio?").
  b) Cuando necesites confirmar algo Y seguir con el siguiente campo: primer mensaje confirma ("Genial, guardo el horario."), segundo pregunta lo siguiente.
  c) Cuando quieras un quiebre natural entre un comentario empático y una pregunta.

- Casos de 1 mensaje (default para respuestas simples):
  a) Preguntas directas cuando el usuario solo escribió texto.
  b) Re-preguntas / clarificaciones (mantén todo en 1 mensaje para no abrumar).

- Cada mensaje individual: máximo 2 oraciones, cálido, sin preámbulo. MÁXIMO 3 mensajes por turno.
- Cuando uses 2-3 mensajes, el PRIMERO es el acuse / reacción corta, y el ÚLTIMO es la pregunta / acción. No repitas la misma idea en varios mensajes.

REGLA ESPECIAL — INSIGHT DE INDUSTRIA:
Cuando detectas el vertical por PRIMERA vez en la conversación, el servidor automáticamente prepende una burbuja con un insight de la industria (una estadística + value prop de atiende). NO duplicar ese estilo de contenido en tus propios mensajes. Ve directo al siguiente paso natural ("Para empezar, ¿cómo se llama tu consultorio?"). Típicamente 1 mensaje es suficiente en ese turno — el insight + tu mensaje = 2 burbujas totales.

FORMATO DE RESPUESTA (JSON estricto, nada más):
{
  "vertical": "<enum del vertical o null si aún no sabes>",
  "updatedFields": { "qN": "valor", ... },
  "assistantMessages": ["mensaje 1", "mensaje 2 (opcional)", "mensaje 3 (opcional)"],
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

  // Build the final user turn, with scraped markdown / uploaded content appended
  // as appendix blocks if present.
  let finalUserContent = input.userMessage;

  if (input.scrapedMarkdown) {
    finalUserContent += `\n\n--- CONTENIDO DEL SITIO WEB DEL USUARIO (scraping automático) ---\n${input.scrapedMarkdown}\n--- FIN DEL CONTENIDO ---`;
  } else if (input.scrapeError) {
    finalUserContent += `\n\n(nota interna: intentamos abrir el link que pegó el usuario pero falló: ${input.scrapeError}. Pídele los datos a mano.)`;
  }

  if (input.uploadedContent && input.uploadedContent.length > 0) {
    for (const item of input.uploadedContent) {
      finalUserContent += `\n\n--- ARCHIVO SUBIDO POR EL USUARIO: ${item.filename} (extracción automática con visión) ---\n${item.markdown}\n--- FIN DEL ARCHIVO ---`;
    }
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
  // Handle "waitlist" — unsupported vertical detected by the agent
  const rawVertical = result.data.vertical;
  const effectiveVertical: VerticalEnum | 'waitlist' | null =
    rawVertical === 'waitlist'
      ? 'waitlist'
      : (rawVertical as VerticalEnum | null) ?? input.vertical;

  // Filter updatedFields to valid keys only
  let filteredFields: Record<string, string> = {};
  if (effectiveVertical && effectiveVertical !== 'waitlist') {
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

  // Defensive: trim, drop empties, cap at 3. Guarantees the client always gets
  // at least one non-empty message (Zod schema already enforces min length,
  // but a whitespace-only entry would sneak past — filter it here).
  const cleanMessages = result.data.assistantMessages
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .slice(0, 3);
  const assistantMessages: string[] =
    cleanMessages.length > 0
      ? cleanMessages
      : ['Dame un segundo para pensar eso...'];

  return {
    vertical: effectiveVertical,
    updatedFields: filteredFields,
    assistantMessages,
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
