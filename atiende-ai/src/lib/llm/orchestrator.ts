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
const PRIMARY_TIMEOUT_MS = 10_000;
const FALLBACK_TIMEOUT_MS = 10_000;

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

  // ── Intento 1: modelo primario con timeout ──
  try {
    const result = await withTimeout(
      generateWithTools({
        model: MODELS.ORCHESTRATOR,
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
        toolExecutor,
        tool_choice: 'auto',
        // BUG 7 FIX: tool-calling requiere espacio para que el modelo emita
        // el JSON del tool_call + razonamiento intermedio + respuesta final.
        // Con 800 tokens Grok truncaba tool_calls en conversaciones con
        // mucho historial. 2000 da margen y sigue siendo barato.
        maxTokens: ctx.tools.length > 0 ? 2000 : 800,
        temperature: 0.5,
        maxToolRounds: 5,
      }),
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
    // Loggeamos pero continuamos a fallback. Tipos de error esperados:
    //  - OrchestratorTimeoutError: provider lento
    //  - LoopGuardError: el modelo no convergió en 5 rounds
    //  - Cualquier error de OpenRouter SDK (5xx, network)
    const errName = primaryErr instanceof Error ? primaryErr.name : 'unknown';
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(
      `[orchestrator] primary model (${MODELS.ORCHESTRATOR}) failed → ${errName}: ${errMsg}. Trying fallback.`,
    );

    // ── Intento 2: modelo fallback CON timeout ──
    // Crítico: sin este timeout, una degradación de GPT-4.1-mini colgaría
    // el request indefinidamente (el usuario no recibe respuesta jamás).
    try {
      const result = await withTimeout(
        generateWithTools({
          model: MODELS.ORCHESTRATOR_FALLBACK,
          system: ctx.systemPrompt,
          messages: ctx.messages,
          tools: ctx.tools,
          toolExecutor,
          tool_choice: 'auto',
          maxTokens: 800,
          temperature: 0.5,
          maxToolRounds: 5,
        }),
        FALLBACK_TIMEOUT_MS,
      );

      return {
        responseText: result.finalText,
        toolCallsExecuted: result.toolCallsExecuted,
        agentUsed,
        modelUsed: result.model,
        fallbackUsed: true,
        costUsd: result.cost,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
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
