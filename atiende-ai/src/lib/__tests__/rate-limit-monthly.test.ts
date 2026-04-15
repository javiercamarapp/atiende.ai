import { describe, it, expect, vi, beforeEach } from 'vitest';

// Redis mock (fail-open cuando no hay env vars)
vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    private store = new Map<string, number>();
    async incr(key: string): Promise<number> {
      const cur = (this.store.get(key) || 0) + 1;
      this.store.set(key, cur);
      return cur;
    }
    async expire(_key: string, _ttl: number): Promise<void> { /* no-op */ }
    async get<T>(key: string): Promise<T | null> {
      return (this.store.get(key) as T | undefined) ?? null;
    }
    async set(key: string, value: number): Promise<void> {
      this.store.set(key, value);
    }
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 42, data: null, error: null }),
    })),
  },
}));

describe('rate-limit-monthly', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.UPSTASH_REDIS_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_TOKEN = 'test-token';
  });

  it('incrementa counter en Redis', async () => {
    const { incrementMonthlyMessages } = await import('../rate-limit-monthly');
    const count1 = await incrementMonthlyMessages('tenant-abc');
    const count2 = await incrementMonthlyMessages('tenant-abc');
    expect(count1).toBe(1);
    expect(count2).toBe(2);
  });

  it('tenants distintos tienen counters separados', async () => {
    const { incrementMonthlyMessages } = await import('../rate-limit-monthly');
    const t1a = await incrementMonthlyMessages('tenant-A');
    const t1b = await incrementMonthlyMessages('tenant-A');
    const t2a = await incrementMonthlyMessages('tenant-B');
    expect(t1a).toBe(1);
    expect(t1b).toBe(2);
    expect(t2a).toBe(1); // B arranca de 0
  });

  it('fail-open si Redis no está configurado', async () => {
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.UPSTASH_REDIS_TOKEN;
    vi.resetModules();
    const { incrementMonthlyMessages } = await import('../rate-limit-monthly');
    const count = await incrementMonthlyMessages('tenant-no-redis');
    expect(count).toBe(0); // no rompe, retorna 0
  });

  it('getMonthlyMessageCount fallback a DB cuando Redis no tiene', async () => {
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.UPSTASH_REDIS_TOKEN;
    vi.resetModules();
    const { getMonthlyMessageCount } = await import('../rate-limit-monthly');
    const count = await getMonthlyMessageCount('tenant-needs-db');
    expect(count).toBe(42); // mock DB retorna 42
  });
});
