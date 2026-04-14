// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — corazón del nuevo pipeline agentico (Fase 1)
//
// Esta función reemplaza el trío `classifier → response-builder → engine` del
// pipeline tradicional, en una sola llamada que:
//   1. Recibe el historial completo de la conversación + system prompt + tools
//      del sub-agente que debe atender este turno.
//   2. Llama a `generateWithTools` con el modelo PRIMARIO (Grok 4.1 Fast),
//      envuelto en un timeout de 3 segundos.
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
 * Tiempo máximo para que el modelo primario responda (incluyendo todas las
 * rondas de tool calling). Si lo excede, abortamos y caemos al fallback.
 *
 * 3 segundos según el spec de Fase 1 — Grok 4.1 Fast debería responder en
 * <2s para mensajes típicos. Si tarda más, asumimos provider degradado y
 * preferimos la respuesta del fallback que tarde un poco más a no responder.
 *
 * NOTA: este timeout cubre el TOTAL de la corrida (LLM rounds + tool exec).
 * En Fase 1 el registry de tools está vacío, así que en la práctica es
 * timeout sobre 1 LLM call.
 */
const PRIMARY_TIMEOUT_MS = 3_000;

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
        // Prompt + history pueden ser largos; damos margen al output.
        maxTokens: 800,
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

    // ── Intento 2: modelo fallback (sin timeout — dejarlo ejecutar) ──
    try {
      const result = await generateWithTools({
        model: MODELS.ORCHESTRATOR_FALLBACK,
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
        toolExecutor,
        tool_choice: 'auto',
        maxTokens: 800,
        temperature: 0.5,
        maxToolRounds: 5,
      });

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
