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

/**
 * Ejecuta una tool por nombre. Captura excepciones y mide tiempo. NUNCA tira
 * — el orchestrator necesita un resultado estructurado para pasar al LLM.
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
    const result = await def.handler(args, ctx);
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
