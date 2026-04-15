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
import { ACTIVE_VERTICALS, ALL_VERTICALS, VERTICAL_NAMES, isActiveVertical } from '@/lib/verticals';
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
  vertical: VerticalEnum | null;
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

// El schema acepta TODOS los verticals (ACTIVOS + FUTUROS) porque Valeria
// necesita poder DETECTAR el vertical del usuario incluso si está en standby —
// eso le permite responder con el mensaje formal de rechazo cuando aplica.
const VerticalEnumSchema = z.enum(ALL_VERTICALS as [VerticalEnum, ...VerticalEnum[]]);

const AgentOutputSchema = z.object({
  vertical: z.union([VerticalEnumSchema, z.null()]),
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

  const activeVerticalList = ACTIVE_VERTICALS.join(', ');
  const futureVerticalList = ALL_VERTICALS.filter((v) => !isActiveVertical(v)).join(', ');
  const verticalIsActive = vertical ? isActiveVertical(vertical) : null;

  return `Eres Valeria, la agente de pre-conversación de useatiende.ai. Tu trabajo es conocer el negocio del cliente mediante una charla natural (NO un cuestionario) para configurar su agente AI de reservas. Hablas español mexicano, cálido, breve y profesional. Te presentas como Valeria cuando es natural hacerlo.

⚠️  ENFOQUE ACTUAL DE ATIENDE.AI:
useatiende.ai v1 se enfoca EXCLUSIVAMENTE en agentes de reservas para los sectores de SALUD y ESTÉTICA — todos aquellos negocios cuyo pilar operativo es el dashboard de Citas (médicos, dentistas, psicólogos, nutriólogos, veterinarios, dermatólogos, estilistas, spas, gimnasios, etc.).

Verticales ACTIVOS (los únicos que puedes configurar): ${activeVerticalList}

Verticales EN STANDBY (por ahora no disponibles): ${futureVerticalList}

REGLA DE RECHAZO FORMAL:
Si el usuario describe un negocio que cae en un vertical EN STANDBY (ej: restaurante, hotel, taller mecánico, florería, farmacia, etc.), NO inicies el flujo de captura de campos. En su lugar, responde con UN SOLO mensaje formal y cálido, con este contenido (adáptalo al giro específico del usuario):

"Gracias por escribirnos. Por el momento, useatiende.ai está enfocado exclusivamente en agentes de reservas para los sectores de salud y estética — médicos, dentistas, psicólogos, estilistas, spas, gimnasios y similares. Estaremos habilitando más industrias próximamente. Si gustas, déjame tu nombre, correo o WhatsApp y te avisamos cuando tu sector esté disponible."

En ese caso, marca done=true, vertical=(el que detectaste aunque sea futuro), updatedFields={}, clarificationOf=null. No pidas más datos.

${header}
${vertical ? `VERTICAL ACTIVO: ${verticalIsActive ? 'SI — continua con el flujo normal' : 'NO — aplica la REGLA DE RECHAZO FORMAL arriba'}` : ''}

TU OBJETIVO: capturar TODOS los campos marcados [REQ] en el schema de abajo. No marcas done=true hasta que cada campo [REQ] tenga valor concreto.

CAMPOS A CAPTURAR:
${fieldsBlock}

REGLAS DURAS:
1. REGLA MÁS IMPORTANTE — NUNCA respondas SOLO con un acuse ("Perfecto", "Anotado", "Genial", "Gracias"). Cada turno donde aceptas/llenas un campo DEBE incluir la siguiente pregunta en el mismo response, y el ÚLTIMO mensaje del array assistantMessages SIEMPRE debe terminar con '?' (signo de interrogación). Formato correcto: "Anotado. ¿Quién es el dentista titular?" Formato INCORRECTO: "Perfecto, anotado: Dr. Javier, Cirujano Dentista." (eso es un callejón sin salida — el usuario no sabe qué hacer después). La ÚNICA excepción es cuando done=true.
   Antes de responder, relee tu último mensaje mentalmente: si no termina en '?', REESCRÍBELO para incluir una pregunta sobre el siguiente campo [REQ] pendiente. No hay excepciones mientras done=false.
2. Un solo tema por turno. No hagas preguntas dobles, pero SÍ puedes (y debes) combinar un acuse corto + una pregunta nueva en el mismo turno.
3. Si el usuario pega una URL, asume que nosotros ya procesamos su sitio; NO le pidas que la vuelva a mandar. Usa el contenido extraído (aparece abajo en "CONTENIDO DEL SITIO WEB") para llenar campos. SOLO llena campos con datos que aparezcan LITERALMENTE en el markdown. Si no están, pregunta normal.
3b. NUNCA digas frases como "vi tu sitio", "encontré tu dirección" o similares a menos que el bloque "CONTENIDO DEL SITIO WEB DEL USUARIO" esté presente en este turno con contenido real. Si el usuario solo escribió texto, usa 1 solo mensaje y pregunta normalmente.
4. Si el usuario sube archivos o imágenes (menús, listas de precios, fotos de cédulas, logos, cartas), aparecerán abajo como "ARCHIVO SUBIDO POR EL USUARIO". Ya fueron procesados con visión; NO pidas que los vuelva a mandar. SOLO llena campos con datos que aparezcan LITERALMENTE en la extracción del archivo. Agradece que los haya mandado.
5. Si una respuesta es vaga, evasiva o irrelevante ("no sé", "luego te digo", "lo que tú creas", "cualquier cosa"), NO la aceptes. Haz una re-pregunta amable y específica, marca clarificationOf="qN", y NO incluyas ese campo en updatedFields en este turno. Pero si la respuesta es corta pero CONCRETA (ej: "en semana santa", "sí", "no", "formal"), ACÉPTALA, llena el campo, y avanza al siguiente campo pendiente.
6. Si el usuario da un dato que cubre varios campos en una sola frase (ej: "lunes a viernes 9 a 19 y cerramos domingos" llena horario + días de cierre), llena TODOS esos campos en updatedFields.
7. Prefiere siempre el siguiente campo [REQ] pendiente. Los opcionales [ ] los dejas para el final o los omites si el usuario parece con prisa.
8. Si vertical="todavía no identificado", tu primera tarea es inferirlo del mensaje del usuario (o del sitio scrapeado / archivo subido). Responde el enum exacto en el campo "vertical" del JSON. Si el vertical detectado está EN STANDBY (no es activo), aplica la REGLA DE RECHAZO FORMAL de arriba. Si es activo, continúa la conversación normal. Si realmente no puedes inferirlo, pregunta en 1 oración qué tipo de negocio es.
8b. REGLA DE CONFIANZA EN VERTICAL — NO adivines: Solo devuelve un vertical concreto cuando tengas EVIDENCIA CLARA:
    • El usuario lo menciona explícitamente ("soy dentista", "tengo un spa", "clínica veterinaria").
    • Hay contenido REAL scrapeado del sitio (menú, servicios listados, cédula profesional) en el bloque "CONTENIDO DEL SITIO WEB".
    • Hay contenido REAL de un archivo subido en un bloque "ARCHIVO SUBIDO POR EL USUARIO".
    Si el scrape FALLÓ (hay una "nota interna" diciendo que falló) y el mensaje del usuario NO menciona su giro, responde vertical=null y pide en 1 oración que describa su negocio en una frase. NUNCA infieras el vertical solo por el dominio o el slug de una URL (ej: "facebook.com/XXX" NO es evidencia del giro del negocio).
9. Verticales VÁLIDOS para enum: usa cualquier valor de la lista de ACTIVOS (${activeVerticalList}) o STANDBY (${futureVerticalList}). Solo los ACTIVOS continúan con captura de campos.
10. Cuando TODOS los [REQ] estén completos, responde done=true con un mensaje de cierre breve ("Listo, con esto armo tu agente"). Este es el ÚNICO caso donde puedes no incluir pregunta.
11. Nunca inventes datos. Si no sabes algo, pregúntalo. Cuando tengas duda entre "subir un archivo" y "escribirlo a mano", sugiere subir (ej: "¿tienes tu menú en foto? Puedes subirla y la leo").
12. Nunca pidas datos que ya están en [YA CAPTURADO]. Continúa con el siguiente pendiente.
13. CHAT REAL: el usuario puede mandar varios mensajes seguidos sin esperar tu respuesta (como un chat de WhatsApp). Si en el historial ves varios mensajes "user" consecutivos antes de tu turno, trata TODA esa secuencia como contexto — extrae toda la info posible de TODOS esos mensajes y responde al bloque completo con un solo set de updatedFields.

REGLA CLAVE — MENSAJES EN SECUENCIA (assistantMessages):
El campo "assistantMessages" es un array de 1 a 3 mensajes que el cliente renderiza como burbujas separadas con pausas cortas entre ellas. Úsalo así:

- Casos de 2-3 mensajes (preferente):
  IMPORTANTE: Estos son ejemplos de FORMATO solamente. NUNCA los copies literalmente. Genera siempre contenido original basado en los datos reales de esta conversación.
  a) SOLO cuando el bloque "CONTENIDO DEL SITIO WEB DEL USUARIO" o "ARCHIVO SUBIDO" esté presente en este turno: primer mensaje corto mencionando qué datos REALES encontraste en ese contenido. Segundo mensaje con la siguiente pregunta pendiente. Si NO hay scraped content ni archivo en este turno, usa 1 solo mensaje.
     Formato (sustituir con datos reales): ["Vi tu sitio — encontré [campo real A] y [campo real B].", "¿[siguiente campo pendiente]?"]
  b) Cuando necesites confirmar algo Y seguir con el siguiente campo: ["[Confirmación del dato capturado].", "[Siguiente pregunta]?"]
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
    finalUserContent += `\n\n(nota interna: intentamos abrir el link que pegó el usuario pero falló: ${input.scrapeError}. Dile con calidez que no pudiste acceder al link (si es de Facebook / Instagram / redes sociales, mencionalo puntualmente) y pídele UNA de: (a) describir su negocio en una frase, (b) compartir su sitio web propio, o (c) subir una foto de su letrero, tarjeta o cédula. NO inferir el vertical solo por el dominio de la URL.)`;
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
  // Clasificamos contra todos los verticals (activos + futuros) para que el
  // endpoint /api/onboarding/chat pueda distinguir entre "no sé" y "sé pero
  // está en standby" y responder con el mensaje formal correspondiente.
  const verticalListForPrompt = ALL_VERTICALS.map(
    (v) => `${v} (${VERTICAL_NAMES[v]})${isActiveVertical(v) ? '' : ' [STANDBY]'}`,
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
