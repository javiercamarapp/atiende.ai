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
});
