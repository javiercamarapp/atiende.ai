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
import { executeTool, isMutationTool, type ToolContext, type ToolExecutionResult } from '@/lib/llm/tool-executor';
import { checkOpenRouterRateLimit, RateLimitError } from '@/lib/llm/rate-limiter';
import {
  checkCircuit,
  reportFailure as reportBreakerFailure,
  reportSuccess as reportBreakerSuccess,
  CircuitOpenError,
  CIRCUIT_OPEN_USER_MESSAGE,
} from '@/lib/llm/circuit-breaker';

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
  ORCHESTRATOR_TOTAL_TIMEOUT_MS as TOTAL_TIMEOUT_MS,
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
 *
 * AUDIT R18: el cache de mutations exitosas se comparte entre primary y
 * fallback (ambos construyen ToolContext pasando la MISMA Map) para
 * defender contra doble-ejecución aún si el fallback LLM intenta repetir
 * una mutación ya hecha.
 */
function buildToolExecutor(
  ctx: OrchestratorContext,
  sharedCache: Map<string, ToolExecutionResult>,
) {
  const toolCtx: ToolContext = {
    tenantId: ctx.tenantId,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    customerPhone: ctx.customerPhone,
    tenant: ctx.tenant,
    successfulCallCache: sharedCache,
  };
  return async (toolName: string, args: Record<string, unknown>) => {
    return executeTool(toolName, args, toolCtx);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runOrchestrator — entry point público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AUDIT P2 item 5 — GLOBAL wall-clock timeout sobre primary+fallback+tools.
 * Antes cada modelo tenía su propio timeout (10s + 10s = 20s peor caso),
 * más tool execution en el medio (4s × N rondas). En serverless edge eso
 * puede llegar a 25-30s y chocar con el timeout de la función o el retry
 * de Meta. 18s ceiling total deja margen para persist + smart-response
 * downstream dentro del presupuesto de 60s de maxDuration.
 *
 * Si se excede: el AbortController pasado a cada generateWithTools aborta
 * la request HTTP actual; el caller (processor) atrapa el error y envía
 * mensaje de fallback al cliente.
 */
export async function runOrchestrator(
  ctx: OrchestratorContext,
): Promise<OrchestratorResult> {
  const globalController = new AbortController();
  let globalTimer: NodeJS.Timeout | undefined;
  const globalTimeoutPromise = new Promise<never>((_, reject) => {
    globalTimer = setTimeout(() => {
      globalController.abort();
      reject(new OrchestratorTimeoutError(TOTAL_TIMEOUT_MS));
    }, TOTAL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      runOrchestratorInner(ctx, globalController.signal),
      globalTimeoutPromise,
    ]);
  } finally {
    if (globalTimer) clearTimeout(globalTimer);
  }
}

async function runOrchestratorInner(
  ctx: OrchestratorContext,
  globalSignal: AbortSignal,
): Promise<OrchestratorResult> {
  // AUDIT R18: cache compartido entre primary y fallback para defense-in-depth
  // contra ghost mutations. Vive solo en este closure del turn (no global) →
  // nunca leak de state entre invocaciones del orquestador.
  const sharedSuccessCache = new Map<string, ToolExecutionResult>();
  const toolExecutor = buildToolExecutor(ctx, sharedSuccessCache);
  const agentUsed = ctx.agentName || DEFAULT_AGENT_NAME;

  // AUDIT P2 item 7: circuit breaker. Si OpenRouter está caído (5+ fallas
  // consecutivas en 60s), bloqueamos nuevos requests por 30s. El caller
  // (processor.ts) atrapa CircuitOpenError y responde mensaje corto al
  // paciente sin quemar 20s de timeouts primary+fallback.
  await checkCircuit();

  // Rate limit gate — lanza RateLimitError si se excede presupuesto OpenRouter
  // por tenant (60/min) o global (500/min). El caller (processor.ts) debe
  // capturarlo y responder al paciente con mensaje amigable.
  await checkOpenRouterRateLimit(ctx.tenantId);

  // ── Intento 1: modelo primario con timeout + AbortController ──
  const primaryController = new AbortController();
  // Si el timeout global se dispara, propagar al primary inmediatamente.
  const onGlobalAbort = () => primaryController.abort();
  globalSignal.addEventListener('abort', onGlobalAbort, { once: true });
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

    // AUDIT P2 item 7: éxito primary → resetear contador del breaker.
    // Best-effort (no await crítico; si Redis falla seguimos).
    void reportBreakerSuccess();

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

    // AUDIT P2 item 7: reportar falla al breaker. Si supera threshold,
    // el breaker se abrirá y subsequent requests se rechazan inmediato.
    void reportBreakerFailure(`primary:${errName}`);
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

    // Detectar mutaciones ya ejecutadas exitosamente.
    // AUDIT-R9 self-fix: además de !tc.error (no throw), filtramos por
    // result.success !== false. Una tool puede retornar {success:false,
    // error_code:'SLOT_TAKEN'} sin throw — eso NO es mutación exitosa, fue
    // rechazada antes del INSERT. Si lo tratáramos como mutación, el
    // fallback creería que ya se hizo y no reintentaría.
    //
    // AUDIT R14 BUG-010: antes usábamos `MUTATION_PREFIXES.some(...startsWith)`
    // para detectar mutaciones — frágil a renames. Ahora cada tool declara
    // `isMutation: true` en su `registerTool(...)` y consultamos ese flag
    // directamente al registry. Si una tool no está registrada en este
    // proceso (edge case), `isMutationTool` devuelve false y permitimos que
    // el fallback la re-ejecute — comportamiento conservador pero correcto
    // (tool read-only se puede reintentar sin daño).
    const successfulMutations = primaryPartialCalls.filter((tc) => {
      if (tc.error) return false; // tool throw
      if (!isMutationTool(tc.toolName)) return false; // read-only: fallback puede reintentar
      const r = tc.result as { success?: boolean } | null;
      // Si la tool devolvió explícitamente success:false (ej. SLOT_TAKEN),
      // NO es mutación real — fue rechazada antes del INSERT.
      if (r && r.success === false) return false;
      return true;
    });

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

    // Si el timeout global se dispara durante el fallback, abortar también.
    const fallbackController = new AbortController();
    const onGlobalAbortFb = () => fallbackController.abort();
    globalSignal.addEventListener('abort', onGlobalAbortFb, { once: true });
    try {
      const result = await withTimeoutAbort(
        generateWithTools({
          model: MODELS.ORCHESTRATOR_FALLBACK,
          system: fallbackSystemPrompt,
          messages: ctx.messages,
          // AUDIT-R10 CRÍT: si pasamos `[]` algunos providers (OpenAI 400
          // "tools array too short"). OpenRouter se comporta distinto según
          // el modelo destino. Safest: omitir la propiedad via `undefined`.
          // openrouter.ts:491 también normaliza `[]` → undefined pero mejor
          // aquí por claridad y porque tools:undefined + tool_choice:'none'
          // deja al SDK completamente sin noción de tools.
          tools: successfulMutations.length > 0 ? undefined : ctx.tools,
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

      // AUDIT P2 item 7: fallback succeeded → medio reset. Contamos esto
      // como "hay upstream sano" → resetear contador para no abrir breaker
      // innecesariamente si solo el primario está flaky.
      void reportBreakerSuccess();

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

      // AUDIT P2 item 7: ambos modelos fallaron → cuenta como doble falla
      // (ambos upstream del mismo provider rotos).
      void reportBreakerFailure(`fallback:${fbName}`);
      // AUDIT-VC R11: capturar error crítico en Sentry + Supabase para
      // observabilidad en producción (no queda solo en console).
      try {
        const { captureError } = await import('@/lib/observability/error-tracker');
        await captureError(
          new Error(`Orchestrator both models failed: ${errName}/${fbName}`),
          {
            tenantId: ctx.tenantId,
            agentName: agentUsed,
            route: 'orchestrator',
            primaryErr: errMsg,
            fallbackErr: fbMsg,
          },
          'fatal',
        );
      } catch (err) {
        console.error('[orchestrator] captureError failed on both-failed path:', err instanceof Error ? err.message : err);
      }
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
export { CircuitOpenError, CIRCUIT_OPEN_USER_MESSAGE } from '@/lib/llm/circuit-breaker';
