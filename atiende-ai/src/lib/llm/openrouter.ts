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

// ═══ MODELOS ABRIL 2026 — PIVOTE DENTAL + RESTAURANTE ═══
// Qwen 3.5 Flash como workhorse principal + fallbacks
export const MODELS = {
  // ─── MODELO PRINCIPAL ───
  // Qwen3 235B A22B — probado, funciona en OpenRouter, buen español
  PRIMARY: 'qwen/qwen3-235b-a22b-2507',

  // ─── CLASIFICAR INTENT ───
  CLASSIFIER: 'google/gemini-2.5-flash-lite',

  // ─── ENTERPRISE (restaurante alto volumen) ───
  ENTERPRISE: 'deepseek/deepseek-v3.2',

  // ─── TEMAS SENSIBLES ───
  PREMIUM: 'anthropic/claude-sonnet-4-6',

  // ─── FALLBACK ───
  FALLBACK: 'google/gemini-2.5-flash-lite',

  // ─── ONBOARDING CONVERSACIONAL ───
  ONBOARDING_AGENT: 'qwen/qwen3-235b-a22b-2507',
  ONBOARDING_AGENT_FALLBACK: 'google/gemini-2.5-flash-lite',

  // ─── EXTRACCIÓN DE UPLOADS (visión) ───
  // Gemini 2.5 Flash: multimodal para leer menús/cédulas
  BALANCED: 'google/gemini-2.5-flash',

  // ─── VOICE AGENT (v1.1) ───
  VOICE: 'google/gemini-2.5-flash-lite',

  // ─── GENERAR PROMPTS (onboarding) ───
  GENERATOR: 'google/gemini-2.5-flash',

  // ─── Legacy aliases (backward compat) ───
  STANDARD: 'google/gemini-2.5-flash-lite',
} as const;

// Precios por millon de tokens [input, output]
const MODEL_PRICES: Record<string, [number, number]> = {
  'qwen/qwen3.5-flash': [0.065, 0.26],
  'qwen/qwen3.5-9b': [0.02, 0.06],
  'deepseek/deepseek-v3.2': [0.25, 0.38],
  'anthropic/claude-sonnet-4-6': [3.00, 15.00],
  'google/gemini-2.5-flash-lite': [0.10, 0.40],
  'google/gemini-2.5-flash': [0.30, 2.50],
  'qwen/qwen3-235b-a22b-2507': [0.071, 0.10],
  'meta-llama/llama-3.3-70b-instruct': [0.12, 0.30],
};

// ═══ ROUTING POR TIPO DE NEGOCIO + INTENT ═══
// La logica: negocios de SALUD siempre usan modelo medio
// (riesgo de alucinacion medica = inaceptable)
// Negocios de bajo riesgo (taqueria, gym) usan Flash-Lite
// Temas sensibles SIEMPRE van a Claude (no negociable)
export function selectModel(
  intent: string,
  businessType: string,
  plan: string
): string {
  // ── REGLA 1: Plan premium → siempre balanced ──
  if (plan === 'premium') return MODELS.BALANCED;

  // ── REGLA 2: Intents sensibles → Claude (no negociable) ──
  const sensitiveIntents = [
    'EMERGENCY', 'COMPLAINT', 'HUMAN', 'CRISIS',
    'MEDICAL_QUESTION', 'LEGAL_QUESTION'
  ];
  if (sensitiveIntents.includes(intent)) return MODELS.PREMIUM;

  // ── REGLA 3: Negocios de SALUD → Gemini Flash (balanced) ──
  // Porque si alucina un precio de cirugia o un medicamento = problema
  const healthTypes = [
    'dental', 'medical', 'nutritionist', 'psychologist',
    'dermatologist', 'gynecologist', 'pediatrician',
    'ophthalmologist'
  ];
  if (healthTypes.includes(businessType)) return MODELS.BALANCED;

  // ── REGLA 4: Inmobiliaria con temas de credito → balanced ──
  if (businessType === 'real_estate' &&
      ['APPOINTMENT_NEW', 'PRICE', 'LEGAL_QUESTION'].includes(intent)) {
    return MODELS.BALANCED;
  }

  // ── REGLA 5: Veterinaria emergencia → Claude ──
  if (businessType === 'veterinary' && intent === 'EMERGENCY') {
    return MODELS.PREMIUM;
  }

  // ── REGLA 6: Agendamiento/pedidos complejos → balanced ──
  if (['APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'ORDER_NEW',
       'RESERVATION'].includes(intent)) {
    return MODELS.BALANCED;
  }

  // ── REGLA 7: Todo lo demas → Qwen 3.5 Flash (modelo principal) ──
  return MODELS.PRIMARY;
}

// Selección de modelo por tenant (dental vs restaurante vs enterprise)
export function getModelForTenant(tenant: {
  business_type: string;
  plan?: string;
  config?: Record<string, unknown>;
}): string {
  // Restaurante enterprise con muchos pedidos → DeepSeek V3.2
  const monthlyOrders =
    (tenant.config as Record<string, unknown>)?.monthly_orders;
  if (
    tenant.business_type === 'restaurant' &&
    typeof monthlyOrders === 'number' &&
    monthlyOrders > 3000
  ) {
    return MODELS.ENTERPRISE;
  }
  // Todo lo demás → Qwen 3.5 Flash
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
  const jsonSchema = z.toJSONSchema(opts.schema, {
    target: 'draft-7',
  }) as Record<string, unknown>;

  // OpenRouter/OpenAI JSON-schema mode requires `additionalProperties: false`
  // on all object schemas. Zod v4 sometimes omits that flag; inject it.
  const ensureStrict = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object' && obj.additionalProperties === undefined) {
      obj.additionalProperties = false;
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(ensureStrict);
      else if (typeof v === 'object') ensureStrict(v);
    }
  };
  ensureStrict(jsonSchema);

  const attempt = async (
    model: string,
    extraSystemNote?: string,
  ): Promise<StructuredGenerationResult<T>> => {
    const systemContent = extraSystemNote
      ? `${opts.system}\n\n${extraSystemNote}`
      : opts.system;

    // OpenAI SDK typing is permissive here; we use `any` narrowly for
    // response_format because the SDK's union typing doesn't statically
    // accept our derived JSON schema object without friction.
    const response = await getOpenRouter().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemContent },
        ...opts.messages,
      ],
      max_tokens: opts.maxTokens || 600,
      temperature: opts.temperature ?? 0.3,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: opts.jsonSchemaName,
          strict: true,
          schema: jsonSchema,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
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
