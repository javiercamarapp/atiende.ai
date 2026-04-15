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
// Registry global del proceso
// ─────────────────────────────────────────────────────────────────────────────

const toolRegistry = new Map<string, ToolDefinition>();

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

/** Timeout máximo por tool individual. Si una tool tarda más, se aborta para
 * no consumir el presupuesto del orchestrator (10s total) en una sola tool. */
const TOOL_TIMEOUT_MS = 4_000;

/** Máximo de chars que serializamos al pasar el resultado de una tool al LLM.
 * Evita que un get_my_appointments con 200 citas explote tokens y costo. */
const MAX_TOOL_RESULT_CHARS = 8_000;

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

  const start = Date.now();
  try {
    const rawResult = await withToolTimeout(def.handler(args, ctx), TOOL_TIMEOUT_MS, name);
    const result = truncateToolResult(rawResult, name);
    return {
      success: true,
      result,
      durationMs: Date.now() - start,
    };
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
