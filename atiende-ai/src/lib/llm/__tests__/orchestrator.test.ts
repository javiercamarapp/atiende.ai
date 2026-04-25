import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock antes de imports estáticos
vi.mock('@/lib/llm/openrouter', () => ({
  generateWithTools: vi.fn(),
  MODELS: {
    ORCHESTRATOR: 'x-ai/grok-4.1-fast',
    ORCHESTRATOR_FALLBACK: 'openai/gpt-4.1-mini',
  },
  LoopGuardError: class LoopGuardError extends Error {
    constructor(public readonly maxRounds: number) {
      super(`Loop guard tripped at ${maxRounds} rounds`);
      this.name = 'LoopGuardError';
    }
  },
  PartialExecutionError: class PartialExecutionError extends Error {
    constructor(
      message: string,
      public readonly cause: unknown,
      public readonly partialToolCalls: unknown[],
      public readonly partialTokensIn: number,
      public readonly partialTokensOut: number,
      public readonly partialModel: string,
    ) {
      super(message);
      this.name = 'PartialExecutionError';
    }
  },
  calculateCost: (_m: string, _i: number, _o: number) => 0,
}));

vi.mock('@/lib/llm/rate-limiter', () => ({
  checkOpenRouterRateLimit: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    constructor(public readonly scope: 'tenant' | 'global', public readonly retryAfter: number) {
      super(`Rate limit exceeded (${scope}). Retry in ${retryAfter}s.`);
      this.name = 'RateLimitError';
    }
  },
  RATE_LIMIT_USER_MESSAGE: 'Estamos procesando muchas solicitudes en este momento.',
}));

vi.mock('@/lib/llm/tool-executor', () => ({
  executeTool: vi.fn(),
  // Default: tool desconocida → tratada como mutación (default-safe).
  // Tests específicos pueden overridear con mockReturnValueOnce.
  isMutationTool: vi.fn().mockReturnValue(true),
  buildToolCallCacheKey: (n: string, a: unknown) => `${n}:${JSON.stringify(a)}`,
}));

import { runOrchestrator, OrchestratorBothFailedError } from '../orchestrator';
import * as openrouter from '../openrouter';
import * as rateLimiter from '../rate-limiter';

const baseCtx = {
  tenantId: 'tenant-123',
  contactId: 'contact-123',
  conversationId: 'conv-123',
  customerPhone: '5219991234567',
  customerName: 'Test Paciente',
  tenant: { id: 'tenant-123', timezone: 'America/Merida' },
  businessType: 'dental',
  messages: [{ role: 'user' as const, content: 'Hola' }],
  tools: [],
  systemPrompt: 'Eres un asistente.',
};

describe('runOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limit OK (no throw)
    vi.mocked(rateLimiter.checkOpenRouterRateLimit).mockResolvedValue(undefined);
  });

  it('Grok exitoso → retorna resultado sin fallback', async () => {
    vi.mocked(openrouter.generateWithTools).mockResolvedValueOnce({
      finalText: 'Con gusto le ayudo.',
      toolCallsExecuted: [],
      model: 'x-ai/grok-4.1-fast',
      tokensIn: 100,
      tokensOut: 20,
      cost: 0.001,
    });

    const result = await runOrchestrator(baseCtx);

    expect(result.responseText).toBe('Con gusto le ayudo.');
    expect(result.fallbackUsed).toBe(false);
    expect(result.modelUsed).toBe('x-ai/grok-4.1-fast');
    // Solo se llamó al primary, no al fallback
    expect(openrouter.generateWithTools).toHaveBeenCalledTimes(1);
  });

  it('Grok timeout → fallback a GPT-4.1-mini', async () => {
    vi.mocked(openrouter.generateWithTools)
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce({
        finalText: 'Respuesta del fallback.',
        toolCallsExecuted: [],
        model: 'openai/gpt-4.1-mini',
        tokensIn: 100,
        tokensOut: 20,
        cost: 0.001,
      });

    const result = await runOrchestrator(baseCtx);

    expect(result.fallbackUsed).toBe(true);
    expect(result.responseText).toBe('Respuesta del fallback.');
    expect(result.modelUsed).toBe('openai/gpt-4.1-mini');
    expect(openrouter.generateWithTools).toHaveBeenCalledTimes(2);
  });

  it('Ambos fallan → OrchestratorBothFailedError', async () => {
    vi.mocked(openrouter.generateWithTools)
      .mockRejectedValueOnce(new Error('Primary failed'))
      .mockRejectedValueOnce(new Error('Fallback failed'));

    await expect(runOrchestrator(baseCtx)).rejects.toThrow(OrchestratorBothFailedError);
  });

  it('Rate limit activo → lanza RateLimitError sin tocar el LLM', async () => {
    const { RateLimitError } = await import('../rate-limiter');
    vi.mocked(rateLimiter.checkOpenRouterRateLimit).mockRejectedValueOnce(
      new RateLimitError('tenant', 30),
    );

    await expect(runOrchestrator(baseCtx)).rejects.toThrow(/RateLimit|tenant/i);
    // Crítico: no debe haber tocado el LLM
    expect(openrouter.generateWithTools).not.toHaveBeenCalled();
  });

  // ── Partial execution / ghost-mutation defense ────────────────────────────
  // El primary ejecuta una tool de mutación exitosa y luego crashea (network
  // drop, timeout). Sin defensa: el fallback se invocaría con tool_choice='auto'
  // y re-ejecutaría book_appointment → doble booking. Con defensa: el orchestrator
  // detecta la mutación exitosa, NO llama al fallback, y construye la respuesta
  // a partir del summary.
  it('primary ejecuta mutación + crash → usa summary del primary, no llama fallback', async () => {
    const { PartialExecutionError } = await import('../openrouter');
    const partial = new PartialExecutionError(
      'mid-stream crash after tool',
      new Error('socket reset'),
      [
        {
          toolName: 'book_appointment',
          args: { patient_name: 'Juan', datetime: '2026-04-30T10:00' },
          result: { success: true, summary: 'Cita agendada para el 30 de abril a las 10:00.' },
          durationMs: 120,
        },
      ],
      150,
      30,
      'x-ai/grok-4.1-fast',
    );
    vi.mocked(openrouter.generateWithTools).mockRejectedValueOnce(partial);

    const result = await runOrchestrator(baseCtx);

    expect(result.fallbackUsed).toBe(false);
    expect(result.responseText).toBe('Cita agendada para el 30 de abril a las 10:00.');
    expect(result.toolCallsExecuted.length).toBe(1);
    // CRÍTICO: el fallback no se invocó (evita doble-booking).
    expect(openrouter.generateWithTools).toHaveBeenCalledTimes(1);
  });

  // El primary ejecuta una mutación que falló (success=false con error_code) +
  // crash. Esa mutación NO es real (fue rechazada por la tool antes del INSERT).
  // El fallback DEBE re-intentar.
  it('primary tool returns success=false → no es mutación real, fallback puede reintentar', async () => {
    const { PartialExecutionError } = await import('../openrouter');
    const partial = new PartialExecutionError(
      'mid-stream crash',
      new Error('timeout'),
      [
        {
          toolName: 'book_appointment',
          args: { patient_name: 'Ana' },
          result: { success: false, error_code: 'SLOT_TAKEN', message: 'Ese horario fue ocupado.' },
          durationMs: 80,
        },
      ],
      100,
      20,
      'x-ai/grok-4.1-fast',
    );
    vi.mocked(openrouter.generateWithTools)
      .mockRejectedValueOnce(partial)
      .mockResolvedValueOnce({
        finalText: 'Ese horario ya no está disponible. ¿Le ofrezco otra opción?',
        toolCallsExecuted: [],
        model: 'openai/gpt-4.1-mini',
        tokensIn: 80,
        tokensOut: 20,
        cost: 0.0005,
      });

    const result = await runOrchestrator(baseCtx);

    expect(result.fallbackUsed).toBe(true);
    expect(result.responseText).toContain('disponible');
    expect(openrouter.generateWithTools).toHaveBeenCalledTimes(2);
  });

  // Patient state snapshot debe inyectarse al system prompt para sobrevivir
  // truncación de history. Verificamos que la cadena llega al model call.
  it('patientStateSnapshot se concatena al system prompt en primary', async () => {
    const ctxWithSnapshot = {
      ...baseCtx,
      patientStateSnapshot: 'PATIENT STATE:\n- Próximas citas: 2026-04-30 10:00',
    };
    vi.mocked(openrouter.generateWithTools).mockResolvedValueOnce({
      finalText: 'OK',
      toolCallsExecuted: [],
      model: 'x-ai/grok-4.1-fast',
      tokensIn: 50,
      tokensOut: 10,
      cost: 0.0001,
    });

    await runOrchestrator(ctxWithSnapshot);

    const callArgs = vi.mocked(openrouter.generateWithTools).mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('Eres un asistente.');
    expect(callArgs.system).toContain('PATIENT STATE');
    expect(callArgs.system).toContain('2026-04-30 10:00');
  });
});
