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

/**
 * Contexto inyectado a cada tool al ejecutarla. Todo lo que el handler
 * necesita para hacer queries scoped sin que el LLM tenga que pasar IDs.
 */
export interface ToolContext {
  tenantId: string;
  contactId: string;
  conversationId: string;
  customerPhone: string;
  tenant: Record<string, unknown>;
  /**
   * AUDIT R18: defense-in-depth contra ghost mutations (BUG R14).
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
 * AUDIT R18: construye la clave del cache para un (toolName, args).
 * Usamos JSON.stringify estable; si args tiene orden de keys distinto
 * entre calls, el LLM los reproduce en el mismo orden 99% del tiempo,
 * y los edge cases (distinto orden) son aceptables para una cache de
 * defense-in-depth (fail-open: no encontrar en cache → re-ejecuta).
 */
export function buildToolCallCacheKey(name: string, args: unknown): string {
  try {
    return `${name}:${JSON.stringify(args)}`;
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
   * AUDIT R14 BUG-010: flag explícito de mutación (escritura externa).
   * Antes se inferían mutaciones por prefijo del nombre (`book_*`, `cancel_*`).
   * Ese heurístico era frágil — cualquier rename (ej. `book_appointment` →
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
// FIX 3 (audit R4): en Vercel / Next.js el módulo a veces se re-evalúa
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
 * AUDIT R14 BUG-010: devuelve si una tool está marcada como mutación.
 * Usado por el orchestrator para decidir si una tool ejecutada por el primario
 * debe evitarse en el fallback (anti ghost-mutation).
 *
 * Retorna false para tools no registradas (conservador; el fallback puede
 * re-intentarlas sin consecuencias externas).
 */
export function isMutationTool(name: string): boolean {
  const def = toolRegistry.get(name);
  return def?.isMutation === true;
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

function truncateToolResult(result: unknown, name: string): unknown {
  try {
    const json = JSON.stringify(result);
    if (json.length <= MAX_TOOL_RESULT_CHARS) return result;
    // Si el resultado es un array, recortamos al primer N items + meta.
    if (Array.isArray(result)) {
      const truncated: unknown[] = [];
      let acc = 2; // brackets
      for (const item of result) {
        const itemJson = JSON.stringify(item);
        if (acc + itemJson.length + 1 > MAX_TOOL_RESULT_CHARS - 200) break;
        truncated.push(item);
        acc += itemJson.length + 1;
      }
      return {
        _truncated: true,
        _original_count: result.length,
        _kept_count: truncated.length,
        _note: `Resultado de ${name} truncado por exceder ${MAX_TOOL_RESULT_CHARS} chars.`,
        items: truncated,
      };
    }
    // Si es objeto, devolvemos un wrapper con preview.
    return {
      _truncated: true,
      _original_chars: json.length,
      _note: `Resultado de ${name} truncado por exceder ${MAX_TOOL_RESULT_CHARS} chars.`,
      preview: json.slice(0, MAX_TOOL_RESULT_CHARS - 300),
    };
  } catch {
    return result;
  }
}

function withToolTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tool ${name} timeout after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
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

  // AUDIT R18: defense-in-depth — si esta misma (tool, args) ya se ejecutó
  // exitosamente como MUTATION en este turno del orchestrator, devuelve el
  // resultado cacheado sin re-invocar el handler. Previene doble-ejecución
  // aún si el fallback LLM ignora el bloqueo a nivel prompt/tool_choice.
  // Solo aplica a mutations (read-only es idempotente, no hay daño en
  // re-ejecutar — y evitamos stale reads en el cache).
  if (ctx.successfulCallCache && def.isMutation) {
    const cacheKey = buildToolCallCacheKey(name, args);
    const cached = ctx.successfulCallCache.get(cacheKey);
    if (cached) {
      console.info(
        `[tool-executor] blocked duplicate mutation ${name} via cache hit — returning cached result`,
      );
      return {
        ...cached,
        durationMs: 0, // cached; no new work done
      };
    }
  }

  const start = Date.now();
  try {
    const rawResult = await withToolTimeout(def.handler(args, ctx), TOOL_TIMEOUT_MS, name);
    const result = truncateToolResult(rawResult, name);
    const execResult: ToolExecutionResult = {
      success: true,
      result,
      durationMs: Date.now() - start,
    };
    // Persistir en cache solo si es mutation exitosa (no aplica a read-only).
    if (ctx.successfulCallCache && def.isMutation) {
      const r = result as { success?: boolean } | null;
      // No cachear si la tool devolvió explícitamente success:false (ej.
      // SLOT_TAKEN antes del INSERT). Ese es un "try again" válido.
      if (!r || r.success !== false) {
        ctx.successfulCallCache.set(buildToolCallCacheKey(name, args), execResult);
      }
    }
    return execResult;
  } catch (err) {
    return {
      success: false,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Solo para tests: limpia el registry. NO usar en código de producción.
 */
export function _resetRegistryForTesting(): void {
  toolRegistry.clear();
}
