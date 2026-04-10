import OpenAI from 'openai';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-init client
// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter usa la misma interfaz que OpenAI SDK.
// Inicialización diferida para que la falta de OPENROUTER_API_KEY no tumbe el
// build ni rompa callers que no usan el cliente en tiempo de import.

let _client: OpenAI | null = null;

export function getOpenRouter(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  _client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://atiende.ai',
      'X-Title': 'atiende.ai',
    },
  });
  return _client;
}

// ═══ MODELOS ABRIL 2026 — SOLO 2 MODELOS EN PRODUCCIÓN ═══
export const MODELS = {
  // ─── MODELO PRINCIPAL — Qwen 3.5 Flash ───
  // $0.065 input / $0.26 output por M tokens
  // Multimodal (texto + imágenes + PDFs), tool calling, 1M contexto
  // Non-thinking mode para velocidad
  PRIMARY: 'qwen/qwen3.5-flash-02-23',

  // ─── MODELO LIGERO — Qwen 3.5 9B ───
  // $0.05 input / $0.15 output por M tokens
  // Para: clasificar intents, resumir, analizar sentimiento
  LIGHT: 'qwen/qwen3.5-9b',

  // ─── FALLBACK — Gemini Flash-Lite (probado en prod) ───
  FALLBACK: 'google/gemini-2.5-flash-lite',

  // ── Aliases para backward compat ──
  CLASSIFIER: 'qwen/qwen3.5-9b',
  STANDARD: 'qwen/qwen3.5-9b',
  BALANCED: 'qwen/qwen3.5-flash-02-23',
  PREMIUM: 'qwen/qwen3.5-flash-02-23',
  VOICE: 'google/gemini-2.5-flash-lite',
  GENERATOR: 'qwen/qwen3.5-flash-02-23',
  ONBOARDING_AGENT: 'qwen/qwen3.5-flash-02-23',
  ONBOARDING_AGENT_FALLBACK: 'google/gemini-2.5-flash-lite',
  ENTERPRISE: 'qwen/qwen3.5-flash-02-23',
} as const;

// Precios por millon de tokens [input, output]
const MODEL_PRICES: Record<string, [number, number]> = {
  'qwen/qwen3.5-flash-02-23': [0.065, 0.26],
  'qwen/qwen3.5-9b': [0.05, 0.15],
  'google/gemini-2.5-flash-lite': [0.10, 0.40],
};

// ═══ ROUTING — UN SOLO MODELO PARA TODO ═══
// Qwen 3.5 Flash maneja todas las respuestas al cliente.
// Sin routing por complejidad/intent — simplifica y reduce latencia.
export function selectModel(
  _intent: string,
  _businessType: string,
  _plan: string,
): string {
  return MODELS.PRIMARY;
}

export function getModelForTenant(_tenant: {
  business_type: string;
  plan?: string;
  config?: Record<string, unknown>;
}): string {
  // Un solo modelo — Qwen 3.5 Flash para todos
  return MODELS.PRIMARY;
}

// Calcular costo de una request
export function calculateCost(
  model: string, tokensIn: number, tokensOut: number
): number {
  const [rateIn, rateOut] = MODEL_PRICES[model] || [1.0, 5.0];
  return (tokensIn * rateIn + tokensOut * rateOut) / 1_000_000;
}

// Helper: generar respuesta con OpenRouter
export async function generateResponse(opts: {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}) {
  const response = await getOpenRouter().chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      ...opts.messages,
    ],
    max_tokens: opts.maxTokens || 400,
    temperature: opts.temperature || 0.5,
  });

  return {
    text: response.choices[0].message.content || '',
    model: response.model || opts.model,
    tokensIn: response.usage?.prompt_tokens || 0,
    tokensOut: response.usage?.completion_tokens || 0,
    cost: calculateCost(
      opts.model,
      response.usage?.prompt_tokens || 0,
      response.usage?.completion_tokens || 0
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateStructured — JSON-schema constrained output with retry + fallback
// ─────────────────────────────────────────────────────────────────────────────

export class StructuredGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly lastRawContent?: string,
  ) {
    super(message);
    this.name = 'StructuredGenerationError';
  }
}

export interface StructuredGenerationResult<T> {
  data: T;
  raw: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

/**
 * Generate a JSON response validated against a Zod schema.
 *
 * Uses OpenRouter's `response_format: json_schema` for strict constraint. Retries
 * once on JSON parse/validation failure with a corrective system note. If the
 * primary model still fails (or the API errors), falls back to `fallbackModel`
 * and retries once more. Throws `StructuredGenerationError` if all attempts fail.
 */
export async function generateStructured<T>(opts: {
  model: string;
  fallbackModel?: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: z.ZodType<T>;
  jsonSchemaName: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<StructuredGenerationResult<T>> {

  const attempt = async (
    model: string,
    extraSystemNote?: string,
  ): Promise<StructuredGenerationResult<T>> => {
    const systemContent = extraSystemNote
      ? `${opts.system}\n\n${extraSystemNote}`
      : opts.system;

    // Use json_object mode (widely supported) instead of json_schema
    // (which many models on OpenRouter don't support). The system prompt
    // already specifies the exact JSON shape; Zod validates after.
    const response = await getOpenRouter().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemContent },
        ...opts.messages,
      ],
      max_tokens: opts.maxTokens || 600,
      temperature: opts.temperature ?? 0.3,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StructuredGenerationError('JSON parse failed', err, raw);
    }

    const validated = opts.schema.safeParse(parsed);
    if (!validated.success) {
      throw new StructuredGenerationError(
        `Schema validation failed: ${validated.error.message}`,
        validated.error,
        raw,
      );
    }

    const tokensIn = response.usage?.prompt_tokens || 0;
    const tokensOut = response.usage?.completion_tokens || 0;
    return {
      data: validated.data,
      raw,
      model: response.model || model,
      tokensIn,
      tokensOut,
      cost: calculateCost(model, tokensIn, tokensOut),
    };
  };

  // Retry ladder: primary → primary+corrective → fallback → fallback+corrective
  const correctiveNote =
    'IMPORTANTE: Tu respuesta anterior no cumplió con el formato JSON requerido. Responde EXCLUSIVAMENTE con JSON válido que cumpla el schema, sin texto adicional, sin markdown, sin comentarios.';

  const ladder: Array<{ model: string; note?: string }> = [
    { model: opts.model },
    { model: opts.model, note: correctiveNote },
  ];
  if (opts.fallbackModel && opts.fallbackModel !== opts.model) {
    ladder.push({ model: opts.fallbackModel });
    ladder.push({ model: opts.fallbackModel, note: correctiveNote });
  }

  let lastError: unknown;
  for (const step of ladder) {
    try {
      return await attempt(step.model, step.note);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof StructuredGenerationError) throw lastError;
  throw new StructuredGenerationError(
    'All generation attempts failed',
    lastError,
  );
}
