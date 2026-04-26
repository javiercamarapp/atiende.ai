import { getOpenRouter, MODELS } from './openrouter';
import { trackFallback } from '@/lib/monitoring';

// Clasifica el intent de cada mensaje entrante.
// Usa GPT-5 Nano ($0.05/M tokens) — el mas barato del mercado.
// Costo: ~$0.000005 por clasificacion = $4.50/mes a 100K msgs.

// ─────────────────────────────────────────────────────────────────────────────
// Valid intents — MUST match the handler table in src/lib/actions/engine.ts.
// If the LLM returns anything outside this set, we coerce to OTHER so the
// dispatcher's fallback path (response-builder) handles the message.
// ─────────────────────────────────────────────────────────────────────────────

export const VALID_INTENTS = [
  'GREETING', 'FAREWELL', 'FAQ', 'PRICE', 'HOURS', 'LOCATION',
  // SERVICES_INFO has a handler in engine.ts but the classifier prompt never
  // used to emit it — dead code. Added to the enum + prompt below so
  // "qué servicios ofrecen?" can actually route to handleServicesInfo.
  'SERVICES_INFO',
  'APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'APPOINTMENT_CANCEL',
  'ORDER_NEW', 'ORDER_STATUS', 'RESERVATION',
  'COMPLAINT', 'EMERGENCY', 'MEDICAL_QUESTION', 'LEGAL_QUESTION',
  'HUMAN', 'CRISIS', 'REVIEW', 'THANKS', 'SPAM', 'OTHER',
] as const;

export type ValidIntent = (typeof VALID_INTENTS)[number];

const VALID_INTENTS_SET: ReadonlySet<string> = new Set<string>(VALID_INTENTS);

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path: short regex classification for the most frequent, unambiguous
// messages. Skipping the LLM for these saves ~30-40% of classification calls
// in real traffic (greetings, "ok", "gracias" dominate inbound volume).
// Rules:
//  - Only match unambiguous one-word / short-phrase messages.
//  - Length ≤ 30 chars so longer messages still go to the LLM for nuance.
//  - Return null when no rule matches — caller falls through to LLM.
// ─────────────────────────────────────────────────────────────────────────────

export function classifyFastPath(message: string): ValidIntent | null {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return null;
  const lower = trimmed.toLowerCase().replace(/[!.¿?¡,]/g, '').trim();

  // Greetings
  if (/^(hola|buenos?\s*d[íi]as|buenas\s*(tardes|noches)?|buen\s*d[íi]a|hi|hey|holi)$/i.test(lower)) {
    return 'GREETING';
  }
  // Farewells
  if (/^(adi[oó]s|chao|chau|bye|hasta\s*(luego|ma[ñn]ana|pronto))$/i.test(lower)) {
    return 'FAREWELL';
  }
  // Thanks
  if (/^(gracias|mil\s*gracias|muchas\s*gracias|grax|thx|thanks)$/i.test(lower)) {
    return 'THANKS';
  }
  // OK / acknowledgement
  if (/^(ok|okay|vale|perfecto|listo|de\s*acuerdo|entendido)$/i.test(lower)) {
    return 'OTHER';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM classifier with enum validation + try/catch
// ─────────────────────────────────────────────────────────────────────────────

// Intents donde una mala clasificación tiene consecuencias graves (efectos
// secundarios: cargo, agendamiento, escalado a humano). Para estos pedimos
// confidence al modelo y, si es < CONFIDENCE_THRESHOLD, reclasificamos con
// un modelo más fuerte. Los demás (GREETING, THANKS, FAQ, etc.) son seguros
// incluso si se equivocan.
const HIGH_STAKES_INTENTS: ReadonlySet<string> = new Set([
  'APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'APPOINTMENT_CANCEL',
  'ORDER_NEW', 'RESERVATION',
  'COMPLAINT', 'EMERGENCY', 'CRISIS',
  'MEDICAL_QUESTION', 'LEGAL_QUESTION',
]);

const CONFIDENCE_THRESHOLD = 0.7;

export interface ClassificationResult {
  intent: ValidIntent;
  confidence: number;
  source: 'fast_path' | 'llm' | 'llm_reclassified' | 'fallback';
}

// Llama al modelo y le pide intent + confidence en un JSON corto.
// El modelo en modo `temperature=0` con prompt explícito da self-reported
// confidence muy correlacionada con accuracy real.
async function llmClassify(
  message: string,
  model: string,
): Promise<{ intent: string; confidence: number } | null> {
  try {
    const response = await getOpenRouter().chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Clasifica el mensaje del cliente. Responde SOLO con JSON exacto:
{"intent":"CATEGORIA","confidence":0.0_a_1.0}

Categorias permitidas:
GREETING, FAREWELL, FAQ, PRICE, HOURS, LOCATION, SERVICES_INFO,
APPOINTMENT_NEW, APPOINTMENT_MODIFY, APPOINTMENT_CANCEL,
ORDER_NEW, ORDER_STATUS, RESERVATION,
COMPLAINT, EMERGENCY, MEDICAL_QUESTION, LEGAL_QUESTION,
HUMAN, CRISIS, REVIEW, THANKS, SPAM, OTHER.

SERVICES_INFO: pregunta qué servicios/tratamientos ofrece (catálogo).
PRICE: pregunta cuánto cuesta algo específico.
APPOINTMENT_MODIFY: quiere reagendar/cambiar cita existente.
APPOINTMENT_CANCEL: quiere cancelar cita existente.
EMERGENCY: situación urgente que requiere atención inmediata.
CRISIS: ideación suicida, autolesión, violencia.

confidence = qué tan seguro estás (0.95+ = certeza, 0.6-0.8 = probable, <0.5 = no estoy seguro).`,
        },
        { role: 'user', content: message },
      ],
      max_tokens: 40,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const raw = response.choices[0]?.message?.content || '';
    const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
    if (typeof parsed.intent !== 'string') return null;
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    return {
      intent: parsed.intent.trim().toUpperCase().replace(/[^A-Z_]/g, ''),
      confidence: Math.max(0, Math.min(1, conf)),
    };
  } catch (err) {
    console.warn(`[classifier] LLM call failed (${model}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Clasifica el intent con confianza calibrada y reclasificación adaptativa.
 *
 * Reglas:
 *   1. Fast-path regex → confidence = 1.0 (determinístico).
 *   2. LLM standard (gpt-4o-mini). Si intent ∉ HIGH_STAKES, devuelve.
 *   3. Si intent ∈ HIGH_STAKES y confidence < threshold → reclasifica con
 *      modelo más fuerte (Gemini Flash). Aceptamos el segundo verdict.
 *   4. Si AÚN está bajo threshold → coerce a HUMAN (escala a operador
 *      humano en lugar de tomar acción equivocada).
 *
 * Esto convierte "agendar mal una emergencia médica" (catastrófico) en
 * "humano revisa el mensaje" (seguro). El costo extra es marginal porque
 * solo se dispara en intents ambigos de alto riesgo (~5% del tráfico).
 */
export async function classifyIntentWithConfidence(
  message: string,
): Promise<ClassificationResult> {
  const fp = classifyFastPath(message);
  if (fp) {
    return { intent: fp, confidence: 1.0, source: 'fast_path' };
  }

  const first = await llmClassify(message, MODELS.CLASSIFIER);
  if (!first) {
    trackFallback('classifier_low_confidence');
    return { intent: 'OTHER', confidence: 0, source: 'fallback' };
  }

  const intent = (VALID_INTENTS_SET.has(first.intent) ? first.intent : 'OTHER') as ValidIntent;

  if (!HIGH_STAKES_INTENTS.has(intent) || first.confidence >= CONFIDENCE_THRESHOLD) {
    return { intent, confidence: first.confidence, source: 'llm' };
  }

  // High-stakes con confidence baja → reclasifica con modelo más fuerte.
  // BALANCED (Gemini Flash) es ~3x mejor en intents ambiguos por costo
  // marginal (~$0.0003/clasificación).
  const second = await llmClassify(message, MODELS.BALANCED);
  if (!second) {
    // No pudimos reclasificar — escalamos a humano para no equivocarnos.
    trackFallback('classifier_low_confidence');
    return { intent: 'HUMAN', confidence: first.confidence, source: 'llm_reclassified' };
  }

  const secondIntent = (VALID_INTENTS_SET.has(second.intent) ? second.intent : 'OTHER') as ValidIntent;
  if (second.confidence >= CONFIDENCE_THRESHOLD) {
    return { intent: secondIntent, confidence: second.confidence, source: 'llm_reclassified' };
  }

  // Modelo más fuerte tampoco está seguro → escalar a humano. Mejor
  // perder una conversación que reservar/cobrar/cancelar por error.
  trackFallback('classifier_low_confidence');
  return { intent: 'HUMAN', confidence: second.confidence, source: 'llm_reclassified' };
}

// Wrapper retro-compatible: callers que solo quieren el intent siguen
// funcionando. Internamente usa el nuevo flujo con confidence.
export async function classifyIntent(message: string): Promise<ValidIntent> {
  const { intent } = await classifyIntentWithConfidence(message);
  return intent;
}
