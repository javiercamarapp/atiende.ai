// ═════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR — registro central de herramientas para el orquestador
//
// Cada tool es una función TypeScript pura asociada a un JSON-schema
// (ChatCompletionTool) que el LLM ve. En Fase 1 el registry está VACÍO; los
// tools concretos (book_appointment, get_price, etc.) se registran en Fase 2.
//
// Diseño:
//  - El registry es un Map en memoria del proceso. Esto vive bien en Vercel
//    porque Next.js mantiene el módulo cargado entre invocaciones de la
//    misma instancia. Si hay cold start, el registry se reconstruye desde
//    los `registerTool(...)` que se ejecutan al cargar los módulos que los
//    declaran (idiomático: cada archivo de tool hace `registerTool(...)` al
//    importarse).
//  - `executeTool` mide el tiempo y captura excepciones — el orchestrator
//    necesita resultados estructurados, no excepciones que tumben el loop.
//  - `ToolContext` provee a cada handler los IDs del tenant/contacto/conv
//    para que la tool pueda hacer queries scoped sin pedir esos parámetros
//    al LLM (más seguro y más barato en tokens).
// ═════════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';
import { trackError } from '@/lib/monitoring';

const MUTATION_DEDUP_TTL_SECONDS = 60;

let _dedupRedis: Redis | null = null;
function getDedupRedis(): Redis | null {
  if (_dedupRedis) return _dedupRedis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _dedupRedis = new Redis({ url, token });
  return _dedupRedis;
}

async function checkRedisMutationDedup(
  conversationId: string,
  cacheKey: string,
): Promise<boolean> {
  const redis = getDedupRedis();
  if (!redis) return false;
  try {
    const exists = await redis.exists(`mut:${conversationId}:${cacheKey}`);
    return exists === 1;
  } catch {
    return false; // fail-open
  }
}

async function setRedisMutationDedup(
  conversationId: string,
  cacheKey: string,
): Promise<void> {
  const redis = getDedupRedis();
  if (!redis) return;
  try {
    await redis.set(`mut:${conversationId}:${cacheKey}`, '1', {
      ex: MUTATION_DEDUP_TTL_SECONDS,
    });
  } catch {
    // fail-open
  }
}

/**
 * Contexto inyectado a cada tool al ejecutarla. Todo lo que el handler
 * necesita para hacer queries scoped sin que el LLM tenga que pasar IDs.
 */
export interface ToolContext {
  tenantId: string;
  contactId: string;
  conversationId: string;
  customerPhone: string;
  /** Nombre conocido del contacto (profile.name de WhatsApp o dato
   *  acumulado en la conversación). Tools de booking lo usan como fallback
   *  defensivo si el LLM intenta meter el teléfono como patient_name. */
  customerName?: string;
  tenant: Record<string, unknown>;
  /**
   * AbortSignal compartido para que los handlers que hacen I/O externo
   * (Stripe, Conekta, Google Calendar, fetch) cancelen requests in-flight
   * cuando se dispara el timeout de la tool. Sin esto, una tool con 3
   * `await` secuenciales contra APIs lentas dejaría las últimas requests
   * huérfanas tras el timeout — fantasma que puede cobrar/escribir.
   *
   * Lo setea `executeTool` (timeout signal) o el orchestrator (global
   * timeout signal). Tool handlers deben pasarlo a fetch/SDK options:
   *
   *     await stripe.checkout.sessions.create(args, { signal: ctx.signal });
   *     await fetch(url, { signal: ctx.signal });
   */
  signal?: AbortSignal;
  /**
   * Defense-in-depth contra ghost mutations.
   *
   * Cache de tool calls exitosos ya ejecutados en el MISMO turno del
   * orquestador. El orchestrator lo popula con `registerSuccessfulCall()`
   * tras ejecutar el primario; cuando el fallback ejecuta una tool, primero
   * verificamos si ya hay un resultado cacheado con los MISMOS args, y lo
   * devolvemos sin re-invocar el handler.
   *
   * Esto es defensa explícita a nivel CÓDIGO (no prompt) que complementa
   * el `tool_choice: 'none'` ya aplicado cuando hay mutations previas.
   * Si algún día cambiamos a `tool_choice: 'auto'` para el fallback, esta
   * cache previene doble-ejecución.
   *
   * Map key = `${toolName}:${stableArgsHash}`. Opcional: si no se provee,
   * executeTool se comporta como antes (backwards-compat con llamadores
   * de tests o pipelines que no usan orquestador).
   */
  successfulCallCache?: Map<string, ToolExecutionResult>;
}

/**
 * Construye la clave del cache para un (toolName, args).
 * Key ordenada recursivamente para que {a:1,b:2} y {b:2,a:1} produzcan la
 * misma cache key. Antes: cache miss → double mutation.
 */
function sortKeysDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
  }
  return out;
}

export function buildToolCallCacheKey(name: string, args: unknown): string {
  try {
    return `${name}:${JSON.stringify(sortKeysDeep(args))}`;
  } catch {
    return `${name}:[unserializable]`;
  }
}

/**
 * Definición de una tool: el schema que ve el LLM + el handler que se
 * ejecuta cuando el LLM la invoca.
 */
export interface ToolDefinition {
  /** El JSON-schema que se pasa al LLM en `tools: [...]`. */
  schema: OpenAI.Chat.ChatCompletionTool;
  /**
   * Handler de la tool. Recibe los args parseados desde el JSON del LLM
   * (validación adicional es responsabilidad del handler) y el contexto.
   * Debe retornar un valor serializable a JSON (irá en el rol=tool message).
   */
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
  /**
   * Flag explícito de mutación (escritura externa). Antes se inferían
   * mutaciones por prefijo del nombre (`book_*`, `cancel_*`). Ese
   * heurístico era frágil — cualquier rename (ej. `book_appointment` →
   * `schedule_appointment`) rompía el "ghost mutation guard" del fallback.
   *
   * true:  la tool causa efectos externos irreversibles / caros (DB INSERT,
   *        envío de mensaje, cargo a Stripe, llamada a Conekta).
   * false: read-only o cálculo puro (check_availability, get_services).
   *
   * Default = false (read-only) por seguridad: si olvidas marcar una mutación,
   * el fallback podría re-ejecutarla — pero es strictly safer que el lado
   * opuesto (olvidar marcarla como read-only y skipear el fallback a tool
   * crítica).
   */
  isMutation?: boolean;
}

/**
 * Resultado normalizado de una ejecución de tool. El orchestrator necesita
 * { success, result, error, durationMs } sin sorpresas — por eso wrappeamos
 * con try/catch y siempre devolvemos esta forma.
 */
export interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry global del proceso — SINGLETON via globalThis
//
// En Vercel / Next.js el módulo a veces se re-evalúa
// (HMR en dev, o en casos raros de cold-start con code-splitting). Si cada
// re-evaluación crea un Map nuevo, las tools registradas en la instancia
// vieja desaparecen. Colgar el Map de `globalThis` hace que sobreviva a
// cualquier re-import del módulo dentro del mismo V8 isolate.
// ─────────────────────────────────────────────────────────────────────────────

const REGISTRY_SYMBOL = Symbol.for('atiende.toolRegistry');

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_SYMBOL]?: Map<string, ToolDefinition>;
};

const g = globalThis as GlobalWithRegistry;
if (!g[REGISTRY_SYMBOL]) {
  g[REGISTRY_SYMBOL] = new Map<string, ToolDefinition>();
}
const toolRegistry: Map<string, ToolDefinition> = g[REGISTRY_SYMBOL];

/**
 * Registra una tool en el registry global. Idempotente — si la tool ya está
 * registrada con el mismo nombre, sobrescribe (útil para hot-reload en dev).
 */
export function registerTool(name: string, def: ToolDefinition): void {
  if (def.schema.type !== 'function') {
    throw new Error(`Tool "${name}" must have schema.type === "function"`);
  }
  if (def.schema.function.name !== name) {
    throw new Error(
      `Tool "${name}" registered with mismatched schema.function.name="${def.schema.function.name}"`,
    );
  }
  toolRegistry.set(name, def);
}

/**
 * Lista los nombres de todas las tools registradas. Útil para logs y debug.
 * (Phase 1: estará vacío.)
 */
export function listRegisteredTools(): string[] {
  return Array.from(toolRegistry.keys());
}

/**
 * Devuelve si una tool está marcada como mutación. Usado por el orchestrator
 * para decidir si una tool ejecutada por el primario debe evitarse en el
 * fallback (anti ghost-mutation).
 *
 * Default-safe: si la tool NO está registrada (p.ej. drift de deploy, registry
 * vacío en worker nuevo), asumimos que ES mutación. Repetir una lectura es
 * barato; repetir un "book_appointment" silenciosamente es doble-booking.
 */
export function isMutationTool(name: string): boolean {
  const def = toolRegistry.get(name);
  if (!def) return true; // unknown → tratar como mutación
  return def.isMutation !== false;
}

/**
 * Devuelve los schemas de un subconjunto de tools (por nombre) listas para
 * pasarlas al LLM en `generateWithTools({ tools: ... })`.
 *
 * Si pasas `null`/undefined, devuelve TODAS las registradas. Si una tool del
 * array no existe, se omite silenciosamente y se loggea — preferible a
 * crashear, porque permite a los agentes declarar tools opcionales.
 */
export function getToolSchemas(names?: string[] | null): OpenAI.Chat.ChatCompletionTool[] {
  if (!names) {
    return Array.from(toolRegistry.values()).map((d) => d.schema);
  }
  const out: OpenAI.Chat.ChatCompletionTool[] = [];
  for (const name of names) {
    const def = toolRegistry.get(name);
    if (!def) {
      console.warn(`[tool-executor] requested unknown tool: ${name}`);
      continue;
    }
    out.push(def.schema);
  }
  return out;
}

import { TOOL_TIMEOUT_MS, TOOL_RESULT_MAX_CHARS as MAX_TOOL_RESULT_CHARS } from '@/lib/config';

/**
 * Trunca un tool result preservando JSON válido para que el LLM pueda
 * parsear sin romperse. Casos:
 *
 *   1. Array directo → truncamos item-por-item (safe, ya estaba)
 *   2. Objeto con UNA propiedad array (ej. `{ appointments: [...] }`) →
 *      truncamos esa array preservando el resto del shape. Esto cubre el
 *      patrón típico de las tools del proyecto (success+items o
 *      success+appointments+count). ANTES caía al "object preview" que
 *      hacía `json.slice(0, X)` cortando a mitad de string/escape →
 *      JSON inválido para el LLM. Ahora el shape es siempre parseable.
 *   3. Objeto con múltiples arrays grandes → fallback a preview seguro
 *      (re-serializamos solo claves cortas + meta).
 */
function truncateToolResult(result: unknown, name: string): unknown {
  try {
    const json = JSON.stringify(result);
    if (json.length <= MAX_TOOL_RESULT_CHARS) return result;

    // Helper: truncar un array de unknowns midiendo CADA item por su
    // JSON length antes de incluirlo, así NUNCA cortamos a mitad.
    const truncateArrayItems = (arr: unknown[], budget: number) => {
      const out: unknown[] = [];
      let acc = 2; // [ ]
      for (const item of arr) {
        const itemJson = JSON.stringify(item);
        if (acc + itemJson.length + 1 > budget) break;
        out.push(item);
        acc += itemJson.length + 1;
      }
      return out;
    };

    // Caso 1: array directo
    if (Array.isArray(result)) {
      const truncated = truncateArrayItems(result, MAX_TOOL_RESULT_CHARS - 200);
      return {
        _truncated: true,
        _original_count: result.length,
        _kept_count: truncated.length,
        _note: `Resultado de ${name} truncado por exceder ${MAX_TOOL_RESULT_CHARS} chars.`,
        items: truncated,
      };
    }

    // Caso 2: objeto con UNA propiedad array dominante
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const arrayKeys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
      if (arrayKeys.length === 1) {
        const arrayKey = arrayKeys[0];
        const arr = obj[arrayKey] as unknown[];
        // Construir un esqueleto del objeto SIN el array para medir
        // overhead (incluye claves + valores no-array + el wrapper meta).
        const skeleton = { ...obj, [arrayKey]: [] };
        const skeletonJson = JSON.stringify({
          ...skeleton,
          _truncated: true,
          _original_count: arr.length,
          _kept_count: 0,
          _note: `Resultado de ${name} truncado por exceder ${MAX_TOOL_RESULT_CHARS} chars.`,
        });
        const budget = MAX_TOOL_RESULT_CHARS - skeletonJson.length - 50;
        const keptItems = budget > 0 ? truncateArrayItems(arr, budget) : [];
        return {
          ...obj,
          [arrayKey]: keptItems,
          _truncated: true,
          _original_count: arr.length,
          _kept_count: keptItems.length,
          _note: `Resultado de ${name} truncado: ${keptItems.length}/${arr.length} items en "${arrayKey}".`,
        };
      }
    }

    // Caso 3: fallback. Devolvemos solo claves escalares (no arrays/objetos
    // anidados) + meta. NO usamos json.slice() porque corta a mitad de
    // strings escapadas → JSON inválido para el LLM.
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const scalarKeys: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
          scalarKeys[k] = v;
        }
      }
      return {
        ...scalarKeys,
        _truncated: true,
        _original_chars: json.length,
        _note: `Resultado de ${name} demasiado grande (${json.length} chars). Solo se devolvieron campos escalares; los anidados se omitieron.`,
      };
    }

    // Primitivo string demasiado largo (raro): truncar conservando longitud
    // medible y avisar.
    return {
      _truncated: true,
      _original_chars: json.length,
      _note: `Resultado de ${name} demasiado grande para devolver.`,
    };
  } catch {
    return result;
  }
}

/**
 * Race entre la promesa del handler y un timeout. Cuando se vence el timeout
 * llamamos `controller.abort()` para que los handlers que reciben
 * `ctx.signal` cancelen sus requests externas (Stripe/GCal/fetch). Antes el
 * timeout solo rechazaba la promise; las requests HTTP seguían vivas.
 */
function withToolTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  name: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  // Si el orchestrator aborta (global timeout), heredamos.
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Tool ${name} timeout after ${ms}ms`));
    }, ms);
  });

  return Promise.race([run(controller.signal), timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Ejecuta una tool por nombre. Captura excepciones, mide tiempo y aplica
 * timeout individual. NUNCA tira — el orchestrator necesita un resultado
 * estructurado para pasar al LLM.
 */
export async function executeTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const def = toolRegistry.get(name);
  if (!def) {
    return {
      success: false,
      result: null,
      error: `Tool not registered: ${name}`,
      durationMs: 0,
    };
  }

  // Two layers of mutation dedup:
  //
  // Layer 1 (in-memory): the sharedSuccessCache covers primary→fallback
  // within the SAME invocation. Fast, zero-latency.
  //
  // Layer 2 (Redis): cross-instance dedup. If Meta retries a webhook and
  // it lands on a different cold lambda, the in-memory cache is empty.
  // A Redis NX key (60s TTL) catches this case. The conversation lock
  // + wa_message_id idempotency check already cover most retries, but
  // this defends the edge case where the primary executed a mutation,
  // the inbound message was persisted, but the process died before
  // saving the outbound reply — a retry would pass the idempotency
  // check (inbound exists) but the processor would skip processing.
  // However, if QStash retries with a fresh conversationId or the
  // inbound wasn't persisted yet, this Redis guard is the last line.
  // Audit fix: read-only tools también benefician de cache in-memory dentro
  // del mismo turn. Ej: agente puede llamar check_availability(date=hoy)
  // dos veces durante un flujo de booking — segunda llamada devuelve cache
  // sin pegarle a Supabase. Saves ~$50/mo a 1k tenants en tool roundtrips.
  if (!def.isMutation && ctx.successfulCallCache) {
    const cacheKey = buildToolCallCacheKey(name, args);
    const cached = ctx.successfulCallCache.get(cacheKey);
    if (cached) {
      return { ...cached, durationMs: 0 };
    }
  }

  if (def.isMutation) {
    const cacheKey = buildToolCallCacheKey(name, args);
    // Layer 1: in-memory
    if (ctx.successfulCallCache) {
      const cached = ctx.successfulCallCache.get(cacheKey);
      if (cached) {
        console.info(
          `[tool-executor] blocked duplicate mutation ${name} via memory cache`,
        );
        return { ...cached, durationMs: 0 };
      }
    }
    // Layer 2: Redis cross-instance
    const redisHit = await checkRedisMutationDedup(ctx.conversationId, cacheKey);
    if (redisHit) {
      console.info(
        `[tool-executor] blocked duplicate mutation ${name} via Redis dedup`,
      );
      return {
        success: true,
        result: { success: true, summary: 'Already executed (dedup)' },
        durationMs: 0,
      };
    }
  }

  const start = Date.now();
  try {
    const rawResult = await withToolTimeout(
      (signal) => def.handler(args, { ...ctx, signal }),
      TOOL_TIMEOUT_MS,
      name,
      ctx.signal,
    );
    const result = truncateToolResult(rawResult, name);
    const execResult: ToolExecutionResult = {
      success: true,
      result,
      durationMs: Date.now() - start,
    };
    // Logging estructurado: una línea por tool ejecutada. Permite armar
    // dashboards de p50/p95 latencia por tool, error rate, distribución de
    // mutaciones bloqueadas por dedup, etc. El `result_status` discrimina
    // entre "tool exitosa pero respondió success:false" (ej. SLOT_TAKEN)
    // vs "tool exitosa con success:true" — útil para detectar tools que
    // siempre devuelven business-failure (síntoma de bug en la lógica
    // upstream, no en la tool).
    const r = result as { success?: boolean } | null;
    const resultStatus = r && r.success === false ? 'business_failure' : 'ok';
    void track('ok', name);
    logger.info('[tool-executor] tool_executed', {
      tool: name,
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      duration_ms: execResult.durationMs,
      is_mutation: def.isMutation === true,
      result_status: resultStatus,
    });
    if (def.isMutation) {
      if (!r || r.success !== false) {
        const ck = buildToolCallCacheKey(name, args);
        ctx.successfulCallCache?.set(ck, execResult);
        void setRedisMutationDedup(ctx.conversationId, ck);
      }
    } else if (ctx.successfulCallCache) {
      // Audit fix: cachear también read-only para evitar roundtrip duplicado
      // dentro del mismo turn (ej. agente llama check_availability 2 veces).
      const ck = buildToolCallCacheKey(name, args);
      ctx.successfulCallCache.set(ck, execResult);
    }
    return execResult;
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const errKind = errMsg.includes('timeout') ? 'timeout' : 'error';
    void track(errKind, name);
    trackError(`tool_${errKind}:${name}`);
    logger.warn('[tool-executor] tool_failed', {
      tool: name,
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      duration_ms: durationMs,
      err_kind: errKind,
      err: errMsg.slice(0, 300),
    });
    return {
      success: false,
      result: null,
      error: errMsg,
      durationMs,
    };
  }
}

/**
 * Métrica fire-and-forget. Se trackea en `monitoring` para que el dashboard
 * de Ops vea volumen por tool sin tener que parsear los logs. La latencia
 * vive en el log estructurado emitido por executeTool — no la duplicamos
 * acá para evitar inflar el counter set de Redis.
 */
async function track(outcome: 'ok' | 'error' | 'timeout', name: string): Promise<void> {
  try {
    const m = await import('@/lib/monitoring');
    if (outcome !== 'ok') m.trackError(`tool_${outcome}:${name}`);
  } catch {
    /* metric track failure is non-fatal */
  }
}

/**
 * Solo para tests: limpia el registry. NO usar en código de producción.
 */
export function _resetRegistryForTesting(): void {
  toolRegistry.clear();
}
