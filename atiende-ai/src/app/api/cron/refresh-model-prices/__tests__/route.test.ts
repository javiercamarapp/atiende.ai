/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted por vi.mock) ────────────────────────────

const {
  mockUpdateModelPriceCache,
  mockGetTrackedModels,
  mockRedisGet,
  mockRedisSet,
  mockLogCronRun,
} = vi.hoisted(() => ({
  mockUpdateModelPriceCache: vi.fn(),
  mockGetTrackedModels: vi.fn(() => [
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash-lite',
    'x-ai/grok-4.1-fast',
  ]),
  mockRedisGet: vi.fn<(key: string) => Promise<unknown>>(() => Promise.resolve(null)),
  mockRedisSet: vi.fn(() => Promise.resolve('OK')),
  mockLogCronRun: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/llm/openrouter', () => ({
  getTrackedModels: mockGetTrackedModels,
  updateModelPriceCache: mockUpdateModelPriceCache,
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = mockRedisGet;
    set = mockRedisSet;
  },
}));

vi.mock('@/lib/agents/internal/cron-helpers', () => ({
  requireCronAuth: (req: any) => {
    const auth = req.headers.get('authorization');
    if (auth !== 'Bearer test-secret') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    return null;
  },
  logCronRun: mockLogCronRun,
}));

// fetch global
global.fetch = vi.fn();

import { GET } from '../route';

function makeRequest(headers: Record<string, string> = {}): any {
  return new Request('http://localhost/api/cron/refresh-model-prices', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/cron/refresh-model-prices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    process.env.UPSTASH_REDIS_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_TOKEN = 'token';
  });

  it('rechaza sin Bearer CRON_SECRET (401)', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('actualiza precios para modelos trackeados', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-4o-mini',
            pricing: { prompt: '0.00000015', completion: '0.00000060' },
          },
          {
            id: 'google/gemini-2.5-flash-lite',
            pricing: { prompt: '0.0000001', completion: '0.0000004' },
          },
          {
            id: 'some/untracked-model',
            pricing: { prompt: '0.001', completion: '0.002' },
          },
        ],
      }),
    });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('ok');
    expect(json.models_updated).toBe(2);
    expect(mockUpdateModelPriceCache).toHaveBeenCalledTimes(2);
    // Verifica que pasa [input $/M, output $/M] correcto (0.00000015 * 1M = 0.15)
    expect(mockUpdateModelPriceCache).toHaveBeenCalledWith(
      'openai/gpt-4o-mini',
      expect.arrayContaining([expect.closeTo(0.15, 3), expect.closeTo(0.60, 3)]),
    );
  });

  it('omite modelos sin pricing válido', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'openai/gpt-4o-mini' }, // sin pricing
          {
            id: 'x-ai/grok-4.1-fast',
            pricing: { prompt: 'not-a-number', completion: '0.001' },
          },
        ],
      }),
    });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.models_updated).toBe(0);
    expect(json.models_skipped).toBe(2);
  });

  it('maneja fallo de fetch a OpenRouter (502)', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network timeout'));

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('fetch_error');
  });

  it('maneja respuesta no-OK de OpenRouter (502)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(502);
  });

  it('detecta cambio de precio >20% y lo reporta en alerts', async () => {
    mockRedisGet.mockResolvedValueOnce([0.15, 0.60]); // previo
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-4o-mini',
            // +50% en ambos
            pricing: { prompt: '0.000000225', completion: '0.0000009' },
          },
        ],
      }),
    });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const json = await res.json();
    expect(json.price_alerts).toBe(1);
  });
});
