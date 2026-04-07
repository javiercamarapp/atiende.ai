// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();

let nextResult: { data: unknown; error: unknown; count?: number } = {
  data: null,
  error: null,
};

function setNext(result: typeof nextResult) {
  nextResult = result;
}

function makeChain() {
  const handler: ProxyHandler<() => unknown> = {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => resolve(nextResult);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  };
  const proxy: any = new Proxy(function () {}, handler);
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => makeChain()),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: vi.fn(() => makeChain()) },
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn(async () => false),
}));

vi.mock('@/lib/billing/stripe', () => ({
  stripe: {
    subscriptions: {
      list: vi.fn(async () => ({ data: [] })),
      update: vi.fn(async () => ({})),
    },
  },
  createCheckoutSession: vi.fn(async () => ({ url: 'https://stripe.test/checkout' })),
  createPortalSession: vi.fn(async () => ({ url: 'https://stripe.test/portal' })),
}));

vi.mock('@/lib/billing/conekta', () => ({
  createOxxoPayment: vi.fn(async () => ({ ok: true })),
  createSpeiPayment: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setNext({ data: { id: 't1', stripe_customer_id: 'cus_1', plan: 'pro' }, error: null });
});

describe('/api/billing/checkout POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../checkout/route');
    const req = new NextRequest('http://localhost/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with stripe url on valid request', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../checkout/route');
    const body = { plan: 'pro', method: 'stripe', email: 'a@b.com' };
    const req = { json: async () => body } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('/api/billing/cancel POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../cancel/route');
    const req = new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 on valid auth', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../cancel/route');
    const req = new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('/api/billing/portal POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../portal/route');
    const req = new NextRequest('http://localhost/api/billing/portal', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with portal url on valid auth', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../portal/route');
    const req = new NextRequest('http://localhost/api/billing/portal', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('/api/billing/usage GET', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { GET } = await import('../usage/route');
    const req = new NextRequest('http://localhost/api/billing/usage');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with count on valid auth', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { GET } = await import('../usage/route');
    const req = new NextRequest('http://localhost/api/billing/usage');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
