import { getOpenRouter, MODELS } from './openrouter';

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

export async function classifyIntent(message: string): Promise<ValidIntent> {
  // 1. Fast-path first — cheap and deterministic.
  const fp = classifyFastPath(message);
  if (fp) return fp;

  // 2. LLM call, defended against network/provider failures.
  let rawText: string;
  try {
    const response = await getOpenRouter().chat.completions.create({
      model: MODELS.CLASSIFIER,
      messages: [
        {
          role: 'system',
          content: `Clasifica el mensaje del cliente en UNA sola categoria.
Categorias posibles:
  GREETING, FAREWELL, FAQ, PRICE, HOURS, LOCATION,
  APPOINTMENT_NEW, APPOINTMENT_MODIFY, APPOINTMENT_CANCEL,
  ORDER_NEW, ORDER_STATUS, RESERVATION,
  COMPLAINT, EMERGENCY, MEDICAL_QUESTION, LEGAL_QUESTION,
  HUMAN, CRISIS, REVIEW, THANKS, SPAM, OTHER.
Responde SOLO la categoria, nada mas.`,
        },
        { role: 'user', content: message },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    rawText = response.choices[0]?.message?.content || '';
  } catch (err) {
    // LLM network failure, timeout, provider outage, etc. — don't crash the
    // whole message pipeline. Falling back to OTHER routes to the generic
    // response builder which still attempts to be helpful via RAG.
    console.warn('[classifier] LLM call failed, falling back to OTHER:', err);
    return 'OTHER';
  }

  // 3. Enum validation — the LLM can drift (extra text, wrong case, a whole
  //    sentence). Coerce invalid outputs to OTHER.
  const normalized = rawText.trim().toUpperCase().replace(/[^A-Z_]/g, '');
  if (VALID_INTENTS_SET.has(normalized)) {
    return normalized as ValidIntent;
  }
  console.warn('[classifier] LLM returned invalid intent, coercing to OTHER:', JSON.stringify(rawText));
  return 'OTHER';
}
