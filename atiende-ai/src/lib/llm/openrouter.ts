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

// ═══ MODELOS MARZO 2026 — MEJOR CALIDAD-PRECIO ═══
// Gemini 2.5 Flash como workhorse + Claude para sensible
export const MODELS = {
  // ─── CLASIFICAR INTENT (cada mensaje) ───
  // GPT-5 Nano: $0.05/$0.40 — el MAS barato del mercado
  // Solo responde 1 palabra. 100K clasificaciones ≈ $4.50/mes
  CLASSIFIER: 'openai/gpt-5-nano',

  // ─── CHAT CASUAL / FAQ (70% del trafico) ───
  // Gemini 2.5 Flash-Lite: $0.10/$0.40 — 75% mas barato que GPT-4.1-mini
  // Ultra baja latencia, buen espanol, 1M contexto
  // PARA: horarios, ubicacion, precios, info general
  STANDARD: 'google/gemini-2.5-flash-lite',

  // ─── CHAT PROFESIONAL (20% del trafico) ───
  // Gemini 2.5 Flash: $0.30/$2.50 — workhorse de Google
  // Razonamiento avanzado, 1M contexto, multilingue excelente
  // PARA: agendar citas multi-step, pedidos complejos, leads BANT
  BALANCED: 'google/gemini-2.5-flash',

  // ─── TEMAS SENSIBLES (10% del trafico) ───
  // Claude Sonnet 4.6: $3.00/$15.00 — maximo safety
  // Mejor anti-alucinacion. No diagnostica, no receta.
  // PARA: quejas, emergencias, preguntas medicas, crisis mental,
  //       temas legales, creditos hipotecarios
  PREMIUM: 'anthropic/claude-sonnet-4-6',

  // ─── VOICE AGENT ───
  // Gemini 2.5 Flash-Lite: ultra baja latencia para voz real-time
  VOICE: 'google/gemini-2.5-flash-lite',

  // ─── GENERAR PROMPTS (onboarding) ───
  // Gemini 2.5 Flash: buen seguimiento de instrucciones largas
  GENERATOR: 'google/gemini-2.5-flash',

  // ─── ONBOARDING CONVERSACIONAL (pre-conversacion con scraping) ───
  // Qwen3 235B A22B Instruct 2507 — open source top, Apache 2.0
  // $0.071 input / $0.10 output por M tokens. 262K contexto.
  // Fuerte en espanol (119 idiomas), top IFEval, JSON robusto.
  // ~$0.0026/sesion (~38k sesiones / $100/mes)
  ONBOARDING_AGENT: 'qwen/qwen3-235b-a22b-2507',

  // ─── FALLBACK DEL ONBOARDING AGENT ───
  // Llama 3.3 70B Instruct — $0.12/$0.30, solido como red de seguridad
  ONBOARDING_AGENT_FALLBACK: 'meta-llama/llama-3.3-70b-instruct',

  // ─── ORQUESTADOR DE TOOL CALLING (Fase 1) ───
  // Grok 4.1 Fast — modelo primario para el nuevo pipeline agentico que
  // expone `tools` al LLM y ejecuta el loop hasta una respuesta final.
  // Elegido por baja latencia + soporte robusto de tool calling vía
  // OpenRouter. Vivirá detrás del feature flag USE_TOOL_CALLING durante
  // la migración; cuando el flag está OFF estos modelos no se invocan.
  ORCHESTRATOR: 'x-ai/grok-4.1-fast',

  // ─── FALLBACK DEL ORQUESTADOR ───
  // GPT-4.1 mini — cobertura cuando Grok devuelve error o supera el
  // presupuesto de tiempo (3s en la implementación actual del orchestrator).
  ORCHESTRATOR_FALLBACK: 'openai/gpt-4.1-mini',

  // ─── BATCH NOCTURNO (analytics, digests, intelligence) ───
  // DeepSeek V3.2 — barato para cargas grandes sin SLA de latencia.
  // $0.14 input / $0.28 output por M tokens. Ideal para generación de insights
  // sobre conversaciones cerradas, métricas por tenant, etc. (cron intelligence).
  BATCH: 'deepseek/deepseek-v3.2-exp',
} as const;

// Precios por millon de tokens [input, output]
const MODEL_PRICES: Record<string, [number, number]> = {
  'openai/gpt-5-nano': [0.05, 0.40],
  'google/gemini-2.5-flash-lite': [0.10, 0.40],
  'google/gemini-2.5-flash': [0.30, 2.50],
  'anthropic/claude-sonnet-4-6': [3.00, 15.00],
  'qwen/qwen3-235b-a22b-2507': [0.071, 0.10],
  'meta-llama/llama-3.3-70b-instruct': [0.12, 0.30],
  // Tool calling orchestrator models (Fase 1)
  'x-ai/grok-4.1-fast': [0.20, 1.50],
  'openai/gpt-4.1-mini': [0.40, 1.60],
  // Batch nocturno para intelligence cron
  'deepseek/deepseek-v3.2-exp': [0.14, 0.28],
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

  // ── REGLA 7: Todo lo demas → Flash-Lite (ultra barato) ──
  // Horarios, ubicacion, FAQ simples, saludos, despedidas
  return MODELS.STANDARD;
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

// ═════════════════════════════════════════════════════════════════════════════
// TOOL CALLING — Fase 1 de la migración a arquitectura agentica
//
// `generateWithTools` ejecuta el ciclo completo de tool calling:
//   1. Llama al modelo con la lista de `tools` disponibles.
//   2. Si el modelo devuelve `tool_calls`, ejecuta cada herramienta vía el
//      `executeTool` callback inyectado por el caller (el caller pone el
//      mapeo nombre→handler; aquí no conocemos los nombres concretos).
//   3. Inyecta cada resultado como un mensaje role=tool y vuelve a llamar.
//   4. Repite hasta `maxToolRounds` o hasta que el modelo emita texto final.
//   5. Si se agotan los rounds sin texto final, lanza LoopGuardError.
//
// Esta función NO toca `generateResponse` ni `generateStructured`. Es un
// helper independiente que el `orchestrator.ts` consume.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Registro de una sola tool ejecutada durante una corrida del orquestador.
 * El caller usa esto para auditar (tabla `tool_call_logs`) y para debugging.
 */
export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
};

/**
 * Lanzada cuando el modelo entra en un loop de tool calls que excede
 * `maxToolRounds`. Indica un bug en el prompt o en la definición de tools
 * (el modelo no sabe cuándo parar).
 */
export class LoopGuardError extends Error {
  constructor(public readonly rounds: number) {
    super(`Tool calling loop exceeded ${rounds} rounds`);
    this.name = 'LoopGuardError';
  }
}

/**
 * Resultado de una corrida completa del ciclo de tool calling.
 */
export interface GenerateWithToolsResult {
  finalText: string;
  toolCallsExecuted: ToolCallRecord[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

/**
 * Callback que el caller provee para ejecutar tools por nombre. Vive aquí
 * como tipo (no se importa de tool-executor para evitar dependencia
 * circular: openrouter.ts es la capa más baja).
 */
export type ToolExecutorCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ success: boolean; result: unknown; error?: string; durationMs: number }>;

export async function generateWithTools(opts: {
  model: string;
  system: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[];
  toolExecutor: ToolExecutorCallback;
  tool_choice?: 'auto' | 'none' | 'required';
  maxTokens?: number;
  temperature?: number;
  /**
   * Maximo de rondas de tool calls antes de abortar. Cada "ronda" =
   * 1 LLM call. Default 5 = el modelo puede llamar herramientas hasta 4
   * veces y luego DEBE emitir texto final.
   */
  maxToolRounds?: number;
}): Promise<GenerateWithToolsResult> {
  const maxRounds = opts.maxToolRounds ?? 5;
  const client = getOpenRouter();

  // Acumuladores a través de las rondas
  const toolCallsExecuted: ToolCallRecord[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let modelUsed = opts.model;

  // Construimos el array de mensajes que vamos a ir extendiendo turno a turno
  // con assistant tool_calls + tool results. Comenzamos con system + lo que
  // el caller pasó.
  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...opts.messages,
  ];

  // TC-2/TC-8: dedup CROSS-ROUND para tools de lectura (get_/check_/list_).
  // Los mutadores (book_/cancel_/modify_) NUNCA se deduplican: el LLM puede
  // re-ejecutar legítimamente con args corregidos.
  const READ_PREFIXES = ['get_', 'check_', 'list_', 'find_', 'search_'];
  const isReadOnly = (name: string) => READ_PREFIXES.some((p) => name.startsWith(p));
  const crossRoundCache = new Map<string, { success: boolean; result: unknown; error?: string; durationMs: number }>();

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.chat.completions.create({
      model: opts.model,
      messages: conversation,
      tools: opts.tools.length > 0 ? opts.tools : undefined,
      tool_choice: opts.tools.length > 0 ? (opts.tool_choice ?? 'auto') : undefined,
      max_tokens: opts.maxTokens || 800,
      temperature: opts.temperature ?? 0.5,
    });

    totalTokensIn += response.usage?.prompt_tokens || 0;
    totalTokensOut += response.usage?.completion_tokens || 0;
    modelUsed = response.model || opts.model;

    const choice = response.choices[0];
    if (!choice) {
      // Sin choice = respuesta vacía del provider; tratamos como texto vacío.
      return {
        finalText: '',
        toolCallsExecuted,
        model: modelUsed,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cost: calculateCost(opts.model, totalTokensIn, totalTokensOut),
      };
    }

    const toolCalls = choice.message.tool_calls;

    // ── Caso 1: el modelo NO pidió tools — tenemos texto final ──
    if (!toolCalls || toolCalls.length === 0) {
      return {
        finalText: choice.message.content || '',
        toolCallsExecuted,
        model: modelUsed,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cost: calculateCost(opts.model, totalTokensIn, totalTokensOut),
      };
    }

    // ── Caso 2: el modelo pidió 1+ tools — las ejecutamos en paralelo ──
    // Empujamos primero el assistant message (con los tool_calls) al
    // historial — el provider espera ver ese turno antes de los tool results.
    conversation.push({
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    });

    // Dedup: si el LLM llama el mismo tool con los MISMOS args en el mismo
    // round, no ejecutar 2 veces. Aún así devolvemos un tool result por cada
    // tool_call_id para no romper el contrato del LLM.
    const dedupCache = new Map<string, Promise<unknown>>();

    const toolResultMessages = await Promise.all(
      toolCalls.map(async (call) => {
        // Solo manejamos function tool calls (las únicas que existen hoy).
        if (call.type !== 'function') {
          return {
            role: 'tool' as const,
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Unsupported tool type: ${call.type}` }),
          };
        }

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
        } catch (err) {
          // Args no parseables = devolver error como result, dejar al
          // modelo decidir si reintenta o se rinde.
          const errMsg = err instanceof Error ? err.message : 'JSON parse error';
          toolCallsExecuted.push({
            toolName: call.function.name,
            args: {},
            result: null,
            durationMs: 0,
            error: `args_parse: ${errMsg}`,
          });
          return {
            role: 'tool' as const,
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Invalid arguments JSON: ${errMsg}` }),
          };
        }

        // Dedup key: name + args ordenados
        const dedupKey = `${call.function.name}:${JSON.stringify(parsedArgs)}`;

        // 1) Cross-round dedup para read-only tools — evita N consultas
        //    idénticas al check_availability cuando el LLM "olvida" lo que
        //    ya preguntó.
        if (isReadOnly(call.function.name) && crossRoundCache.has(dedupKey)) {
          const cached = crossRoundCache.get(dedupKey)!;
          console.warn(`[tool-dedup] cross-round cache hit for ${call.function.name}`);
          toolCallsExecuted.push({
            toolName: call.function.name,
            args: parsedArgs,
            result: cached.result,
            durationMs: cached.durationMs,
            error: cached.error,
          });
          return {
            role: 'tool' as const,
            tool_call_id: call.id,
            content: JSON.stringify(cached.success ? cached.result : { error: cached.error }),
          };
        }

        // 2) In-round dedup (todas las tools, incluido mutaciones — evita
        //    doble-INSERT por una alucinación instantánea del LLM).
        let execPromise = dedupCache.get(dedupKey) as
          | Promise<{ success: boolean; result: unknown; error?: string; durationMs: number }>
          | undefined;
        if (!execPromise) {
          execPromise = opts.toolExecutor(call.function.name, parsedArgs);
          dedupCache.set(dedupKey, execPromise);
        } else {
          console.warn(`[tool-dedup] Reusing result for ${call.function.name}`);
        }
        const exec = await execPromise;
        if (isReadOnly(call.function.name)) {
          crossRoundCache.set(dedupKey, exec);
        }
        toolCallsExecuted.push({
          toolName: call.function.name,
          args: parsedArgs,
          result: exec.result,
          durationMs: exec.durationMs,
          error: exec.error,
        });

        return {
          role: 'tool' as const,
          tool_call_id: call.id,
          content: JSON.stringify(exec.success ? exec.result : { error: exec.error }),
        };
      }),
    );

    conversation.push(...toolResultMessages);
    // Loop continúa: la siguiente iteración llama al modelo con los resultados.
  }

  // Si llegamos aquí es porque el modelo siguió pidiendo tools sin emitir
  // texto final. Eso indica un loop — abortamos con error explícito.
  throw new LoopGuardError(maxRounds);
}
