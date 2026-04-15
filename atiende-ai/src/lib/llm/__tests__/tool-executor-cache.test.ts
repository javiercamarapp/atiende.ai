import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerTool,
  executeTool,
  buildToolCallCacheKey,
  type ToolContext,
  type ToolExecutionResult,
  _resetRegistryForTesting,
} from '../tool-executor';

// AUDIT R18 Fix C: defense-in-depth cache de mutations exitosas.

function makeCtx(cache?: Map<string, ToolExecutionResult>): ToolContext {
  return {
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    customerPhone: '+5219991234567',
    tenant: {},
    successfulCallCache: cache,
  };
}

describe('buildToolCallCacheKey', () => {
  it('genera key estable para args equivalentes', () => {
    const k1 = buildToolCallCacheKey('book_appointment', { date: '2026-04-15', time: '10:00' });
    const k2 = buildToolCallCacheKey('book_appointment', { date: '2026-04-15', time: '10:00' });
    expect(k1).toBe(k2);
  });

  it('distingue por nombre de tool', () => {
    const k1 = buildToolCallCacheKey('book_appointment', { a: 1 });
    const k2 = buildToolCallCacheKey('cancel_appointment', { a: 1 });
    expect(k1).not.toBe(k2);
  });

  it('no crashea con args no serializables (circular refs)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const key = buildToolCallCacheKey('foo', circular);
    expect(key).toContain('unserializable');
  });
});

describe('executeTool — defense-in-depth cache', () => {
  beforeEach(() => {
    _resetRegistryForTesting();
  });

  it('cachea resultado de mutation exitosa y lo reusa en segunda ejecución', async () => {
    const handler = vi.fn(async () => ({ success: true, appointmentId: 'apt-1' }));
    registerTool('book_appointment', {
      isMutation: true,
      schema: {
        type: 'function',
        function: { name: 'book_appointment', description: 'book', parameters: {} },
      },
      handler,
    });

    const cache = new Map<string, ToolExecutionResult>();
    const ctx = makeCtx(cache);
    const args = { date: '2026-04-15', time: '10:00' };

    // Primera ejecución — handler invocado.
    const r1 = await executeTool('book_appointment', args, ctx);
    expect(r1.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Segunda ejecución con MISMO args — cache hit, handler NO re-invocado.
    const r2 = await executeTool('book_appointment', args, ctx);
    expect(r2.success).toBe(true);
    expect(r2.durationMs).toBe(0); // signal de cache hit
    expect(handler).toHaveBeenCalledTimes(1); // sigue 1, no 2
  });

  it('NO cachea tools read-only — se re-ejecutan normalmente', async () => {
    const handler = vi.fn(async () => ({ slots: ['10:00', '11:00'] }));
    registerTool('check_availability', {
      isMutation: false, // read-only
      schema: {
        type: 'function',
        function: { name: 'check_availability', description: 'check', parameters: {} },
      },
      handler,
    });

    const cache = new Map<string, ToolExecutionResult>();
    const ctx = makeCtx(cache);

    await executeTool('check_availability', { date: '2026-04-15' }, ctx);
    await executeTool('check_availability', { date: '2026-04-15' }, ctx);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('NO cachea mutation que devolvió success:false (ej. SLOT_TAKEN)', async () => {
    const handler = vi.fn(async () => ({ success: false, error_code: 'SLOT_TAKEN' }));
    registerTool('book_appointment', {
      isMutation: true,
      schema: {
        type: 'function',
        function: { name: 'book_appointment', description: 'book', parameters: {} },
      },
      handler,
    });

    const cache = new Map<string, ToolExecutionResult>();
    const ctx = makeCtx(cache);

    await executeTool('book_appointment', { t: '10:00' }, ctx);
    await executeTool('book_appointment', { t: '10:00' }, ctx);

    // Ambas invocaciones al handler (no bloqueada, porque success:false es
    // una tool que rechazó ANTES del INSERT — puede reintentar).
    expect(handler).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('mutations con args distintos NO hacen cache-hit', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    registerTool('book_appointment', {
      isMutation: true,
      schema: {
        type: 'function',
        function: { name: 'book_appointment', description: 'book', parameters: {} },
      },
      handler,
    });

    const cache = new Map<string, ToolExecutionResult>();
    const ctx = makeCtx(cache);

    await executeTool('book_appointment', { time: '10:00' }, ctx);
    await executeTool('book_appointment', { time: '11:00' }, ctx); // args distintos

    expect(handler).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });

  it('sin cache provisto, se comporta como antes (no-op)', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    registerTool('book_appointment', {
      isMutation: true,
      schema: {
        type: 'function',
        function: { name: 'book_appointment', description: 'book', parameters: {} },
      },
      handler,
    });

    const ctx = makeCtx(undefined); // NO cache
    await executeTool('book_appointment', { a: 1 }, ctx);
    await executeTool('book_appointment', { a: 1 }, ctx);

    // Sin cache → ambas corren.
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
