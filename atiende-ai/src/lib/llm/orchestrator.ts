// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — corazón del nuevo pipeline agentico (Fase 1)
//
// Esta función reemplaza el trío `classifier → response-builder → engine` del
// pipeline tradicional, en una sola llamada que:
//   1. Recibe el historial completo de la conversación + system prompt + tools
//      del sub-agente que debe atender este turno.
//   2. Llama a `generateWithTools` con el modelo PRIMARIO (Grok 4.1 Fast),
//      envuelto en un timeout de 10 segundos.
//   3. Si el primario falla (timeout, error de provider, LoopGuardError),
//      reintenta con el modelo FALLBACK (GPT-4.1 mini) y registra que se usó
//      fallback.
//   4. Devuelve el texto final + auditoría de tool calls + telemetría.
//
// El orchestrator NO conoce el negocio — solo orquesta. Quién decide qué
// system prompt y qué tools usar es el caller (processor.ts en producción,
// tests en CI).
// ═════════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import {
  generateWithTools,
  LoopGuardError,
  MODELS,
  PartialExecutionError,
  calculateCost,
  type ToolCallRecord,
} from '@/lib/llm/openrouter';
import { executeTool, type ToolContext } from '@/lib/llm/tool-executor';
import { checkOpenRouterRateLimit, RateLimitError } from '@/lib/llm/rate-limiter';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorContext {
  tenantId: string;
  contactId: string;
  conversationId: string;
  customerPhone: string;
  customerName: string;
  tenant: Record<string, unknown>;
  businessType: string;
  /** Historial completo de la conversación (system + user + assistant turns). */
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  /** Tools disponibles para el sub-agente activo (puede ser []). */
  tools: OpenAI.Chat.ChatCompletionTool[];
  /** System prompt del sub-agente activo. */
  systemPrompt: string;
  /** Nombre del sub-agente (para logging/auditoria). */
  agentName?: string;
}

export interface OrchestratorResult {
  responseText: string;
  toolCallsExecuted: ToolCallRecord[];
  agentUsed: string;
  modelUsed: string;
  fallbackUsed: boolean;
  /** Costo total de la corrida (USD), incluyendo retries con fallback. */
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración del orquestador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tiempo máximo por LLM call. Cubre el TOTAL de la corrida (LLM rounds +
 * tool exec). Grok 4.1 Fast típicamente <2s, pero con tools complejas y
 * múltiples rondas puede subir. 10s garantiza que ningún request se cuelgue
 * indefinidamente — ni en primary ni en fallback.
 */
import {
  ORCHESTRATOR_PRIMARY_TIMEOUT_MS as PRIMARY_TIMEOUT_MS,
  ORCHESTRATOR_FALLBACK_TIMEOUT_MS as FALLBACK_TIMEOUT_MS,
} from '@/lib/config';

/** Default sub-agente cuando el caller no especifica uno. */
const DEFAULT_AGENT_NAME = 'base';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envuelve una promesa con un timeout. Si la promesa no resuelve antes del
 * deadline, rechaza con `OrchestratorTimeoutError`.
 */
class OrchestratorTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Orchestrator timed out after ${ms}ms`);
    this.name = 'OrchestratorTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OrchestratorTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * AUDIT-R7 ALTO: AbortController para cancelar la petición HTTP real al
 * provider cuando nuestro timeout se dispara.
 *
 * Antes, si el modelo primario tardaba 11s y se lanzaba
 * OrchestratorTimeoutError, la llamada HTTP SEGUÍA corriendo en el fondo
 * (OpenRouter eventualmente procesaría y nos facturaría los tokens aunque
 * ya hubiéramos pasado al fallback). Ahora cancelamos el request real.
 *
 * Usage:
 *   const ac = new AbortController();
 *   const p = generateWithTools({ ..., signal: ac.signal });
 *   return await withTimeoutAbort(p, ac, 10_000);
 */
function withTimeoutAbort<T>(
  promise: Promise<T>,
  controller: AbortController,
  ms: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); // cancela la request HTTP real
      reject(new OrchestratorTimeoutError(ms));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Adapter: el toolExecutor que `generateWithTools` espera es una función
 * que recibe (name, args) y resuelve a un ToolExecutionResult. Aquí lo
 * componemos cerrando sobre el `ToolContext` extraído del orchestrator ctx.
 */
function buildToolExecutor(ctx: OrchestratorContext) {
  const toolCtx: ToolContext = {
    tenantId: ctx.tenantId,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    customerPhone: ctx.customerPhone,
    tenant: ctx.tenant,
  };
  return async (toolName: string, args: Record<string, unknown>) => {
    return executeTool(toolName, args, toolCtx);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runOrchestrator — entry point público
// ─────────────────────────────────────────────────────────────────────────────

export async function runOrchestrator(
  ctx: OrchestratorContext,
): Promise<OrchestratorResult> {
  const toolExecutor = buildToolExecutor(ctx);
  const agentUsed = ctx.agentName || DEFAULT_AGENT_NAME;

  // Rate limit gate — lanza RateLimitError si se excede presupuesto OpenRouter
  // por tenant (60/min) o global (500/min). El caller (processor.ts) debe
  // capturarlo y responder al paciente con mensaje amigable.
  await checkOpenRouterRateLimit(ctx.tenantId);

  // ── Intento 1: modelo primario con timeout + AbortController ──
  const primaryController = new AbortController();
  try {
    const result = await withTimeoutAbort(
      generateWithTools({
        model: MODELS.ORCHESTRATOR,
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
        toolExecutor,
        tool_choice: 'auto',
        // BUG 7 FIX: tool-calling requiere espacio para que el modelo emita
        // el JSON del tool_call + razonamiento intermedio + respuesta final.
        maxTokens: ctx.tools.length > 0 ? 2000 : 800,
        temperature: 0.5,
        maxToolRounds: 5,
        signal: primaryController.signal,
      }),
      primaryController,
      PRIMARY_TIMEOUT_MS,
    );

    return {
      responseText: result.finalText,
      toolCallsExecuted: result.toolCallsExecuted,
      agentUsed,
      modelUsed: result.model,
      fallbackUsed: false,
      costUsd: result.cost,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  } catch (primaryErr) {
    const errName = primaryErr instanceof Error ? primaryErr.name : 'unknown';
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(
      `[orchestrator] primary model (${MODELS.ORCHESTRATOR}) failed → ${errName}: ${errMsg}. Trying fallback.`,
    );

    // AUDIT-R8 CRÍT: rescatar tools ya ejecutados por el primario antes del crash.
    // Sin esto, el fallback re-ejecutaba mutaciones (book_appointment, etc)
    // causando doble reserva.
    let primaryPartialCalls: ToolCallRecord[] = [];
    let primaryTokensIn = 0;
    let primaryTokensOut = 0;
    let primaryModel: string = MODELS.ORCHESTRATOR;
    if (primaryErr instanceof PartialExecutionError) {
      primaryPartialCalls = primaryErr.partialToolCalls;
      primaryTokensIn = primaryErr.partialTokensIn;
      primaryTokensOut = primaryErr.partialTokensOut;
      primaryModel = primaryErr.partialModel;
    }

    // Detectar mutaciones ya ejecutadas exitosamente
    const MUTATION_PREFIXES = ['book_', 'cancel_', 'modify_', 'mark_', 'send_', 'save_', 'schedule_', 'track_', 'parse_', 'request_', 'generate_'];
    const successfulMutations = primaryPartialCalls.filter(
      (tc) => !tc.error && MUTATION_PREFIXES.some((p) => tc.toolName.startsWith(p)),
    );

    // CASO ESPECIAL: si una mutación devolvió un `summary` o success, podemos
    // construir la respuesta SIN llamar al fallback (evita gastar tokens y
    // garantiza no doble-ejecución).
    for (const tc of successfulMutations) {
      const r = tc.result as { success?: boolean; summary?: string } | null;
      if (r?.success && r?.summary) {
        console.info(`[orchestrator] primary executed ${tc.toolName} OK — using its summary, skipping fallback`);
        return {
          responseText: r.summary,
          toolCallsExecuted: primaryPartialCalls,
          agentUsed,
          modelUsed: primaryModel,
          fallbackUsed: false,
          costUsd: calculateCost(primaryModel, primaryTokensIn, primaryTokensOut),
          tokensIn: primaryTokensIn,
          tokensOut: primaryTokensOut,
        };
      }
    }

    // ── Intento 2: modelo fallback CON contexto de mutaciones previas ──
    // Si hay mutaciones ya ejecutadas, inyectamos un mensaje system extra
    // ordenando NO re-ejecutar (idempotency a nivel prompt).
    const fallbackSystemPrompt = successfulMutations.length > 0
      ? ctx.systemPrompt + '\n\n' +
        '⚠️ CONTEXTO IMPORTANTE — INTENTO PREVIO PARCIAL:\n' +
        'El modelo anterior YA EJECUTÓ las siguientes tools exitosamente. ' +
        'NO LAS RE-EJECUTES. Solo genera la respuesta final cordial al paciente ' +
        'basándote en estos resultados:\n' +
        successfulMutations.map((tc) =>
          `- ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 200)}) → ${JSON.stringify(tc.result).slice(0, 300)}`,
        ).join('\n')
      : ctx.systemPrompt;

    const fallbackController = new AbortController();
    try {
      const result = await withTimeoutAbort(
        generateWithTools({
          model: MODELS.ORCHESTRATOR_FALLBACK,
          system: fallbackSystemPrompt,
          messages: ctx.messages,
          // Si ya hubo mutación, NO pasamos tools al fallback — solo debe
          // generar el texto final. Esto hace IMPOSIBLE re-ejecutar.
          tools: successfulMutations.length > 0 ? [] : ctx.tools,
          toolExecutor,
          tool_choice: successfulMutations.length > 0 ? 'none' : 'auto',
          maxTokens: ctx.tools.length > 0 ? 2000 : 800,
          temperature: 0.5,
          maxToolRounds: 5,
          signal: fallbackController.signal,
        }),
        fallbackController,
        FALLBACK_TIMEOUT_MS,
      );

      // Mergeamos toolCalls del primario + del fallback para auditoría completa
      const mergedCalls = [...primaryPartialCalls, ...result.toolCallsExecuted];
      return {
        responseText: result.finalText,
        toolCallsExecuted: mergedCalls,
        agentUsed,
        modelUsed: result.model,
        fallbackUsed: true,
        costUsd: result.cost + calculateCost(primaryModel, primaryTokensIn, primaryTokensOut),
        tokensIn: result.tokensIn + primaryTokensIn,
        tokensOut: result.tokensOut + primaryTokensOut,
      };
    } catch (fallbackErr) {
      // Ambos modelos fallaron — re-lanzamos para que el caller decida qué
      // mostrarle al cliente final. processor.ts atrapa esto y envía un
      // mensaje genérico de "hubo un problema, te contactamos en breve".
      const fbName = fallbackErr instanceof Error ? fallbackErr.name : 'unknown';
      const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new OrchestratorBothFailedError(
        `Primary (${errName}: ${errMsg}); Fallback (${fbName}: ${fbMsg})`,
        primaryErr,
        fallbackErr,
      );
    }
  }
}

/**
 * Lanzada cuando AMBOS modelos (primary + fallback) fallan en la misma
 * corrida. El caller debe atrapar esto y mostrar al usuario un mensaje
 * de fallback no-LLM ("Estamos teniendo problemas técnicos...").
 */
export class OrchestratorBothFailedError extends Error {
  constructor(
    message: string,
    public readonly primaryError: unknown,
    public readonly fallbackError: unknown,
  ) {
    super(message);
    this.name = 'OrchestratorBothFailedError';
  }
}

// Re-exports para que processor.ts no tenga que importar de 3 sitios distintos.
export { LoopGuardError } from '@/lib/llm/openrouter';
export type { ToolCallRecord } from '@/lib/llm/openrouter';
export { RateLimitError, RATE_LIMIT_USER_MESSAGE } from '@/lib/llm/rate-limiter';
