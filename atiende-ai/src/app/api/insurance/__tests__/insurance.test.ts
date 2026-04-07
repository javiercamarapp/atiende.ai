// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();

// Configurable per-test result for the awaited query
let nextResult: { data: unknown; error: unknown; count?: number } = {
  data: [],
  error: null,
};

function setNext(result: typeof nextResult) {
  nextResult = result;
}

// Generic chainable proxy that resolves to nextResult when awaited
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
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
  },
}));

vi.mock('@/lib/insurance/credential-vault', () => ({
  encryptCredential: vi.fn(() => 'enc'),
  decryptCredential: vi.fn(() => 'dec'),
}));

vi.mock('@/lib/insurance/circuit-breaker', () => ({
  isCircuitOpen: vi.fn(() => Promise.resolve(false)),
  recordSuccess: vi.fn(() => Promise.resolve()),
  recordFailure: vi.fn(() => Promise.resolve()),
}));

vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(() => ({
    publishJSON: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    set: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(null)),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setNext({ data: [], error: null });
});

describe('/api/insurance/carriers GET', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { GET } = await import('../carriers/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 200 when authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    setNext({ data: [], error: null });
    const { GET } = await import('../carriers/route');
    const res = await GET();
    expect(res.status).toBe(200);
  });
});

describe('/api/insurance/credentials', () => {
  it('GET returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { GET } = await import('../credentials/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('POST returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../credentials/route');
    const req = new NextRequest('http://localhost/api/insurance/credentials', {
      method: 'POST',
      body: JSON.stringify({ carrier_id: 'c1', username: 'u', password: 'p' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('POST returns 400 when required fields missing', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../credentials/route');
    const req = new NextRequest('http://localhost/api/insurance/credentials', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('/api/insurance/quote POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../quote/route');
    const req = new NextRequest('http://localhost/api/insurance/quote', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('/api/insurance/callback POST', () => {
  it('returns 400 when request_id missing', async () => {
    const { POST } = await import('../callback/route');
    const req = new NextRequest('http://localhost/api/insurance/callback', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('/api/insurance/stream GET', () => {
  it('returns 400 when id param missing', async () => {
    const { GET } = await import('../stream/route');
    const req = new NextRequest('http://localhost/api/insurance/stream');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
