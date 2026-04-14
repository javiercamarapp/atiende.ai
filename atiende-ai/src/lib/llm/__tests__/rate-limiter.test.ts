import { describe, it, expect } from 'vitest';
import { RateLimitError, RATE_LIMIT_USER_MESSAGE } from '../rate-limiter';

describe('RateLimitError', () => {
  it('expone scope y retryAfter', () => {
    const err = new RateLimitError('tenant', 42);
    expect(err.scope).toBe('tenant');
    expect(err.retryAfter).toBe(42);
    expect(err.name).toBe('RateLimitError');
    expect(err.message).toContain('tenant');
    expect(err.message).toContain('42');
  });

  it('global scope funciona', () => {
    const err = new RateLimitError('global', 15);
    expect(err.scope).toBe('global');
  });

  it('es instanceof Error', () => {
    const err = new RateLimitError('tenant', 10);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('RATE_LIMIT_USER_MESSAGE', () => {
  it('es texto en español mexicano', () => {
    expect(RATE_LIMIT_USER_MESSAGE).toContain('Un momento');
    expect(RATE_LIMIT_USER_MESSAGE).toContain('por favor');
  });

  it('no expone detalles técnicos al usuario', () => {
    expect(RATE_LIMIT_USER_MESSAGE.toLowerCase()).not.toContain('rate');
    expect(RATE_LIMIT_USER_MESSAGE.toLowerCase()).not.toContain('limit');
    expect(RATE_LIMIT_USER_MESSAGE.toLowerCase()).not.toContain('openrouter');
  });
});

describe('checkOpenRouterRateLimit (sin redis)', () => {
  it('fail-open cuando Redis no configurado', async () => {
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.UPSTASH_REDIS_TOKEN;
    const { checkOpenRouterRateLimit } = await import('../rate-limiter');
    // No debe lanzar si Redis no está disponible
    await expect(
      checkOpenRouterRateLimit('fab31042-fba2-4321-8b15-814a4cdff931'),
    ).resolves.toBeUndefined();
  });
});
