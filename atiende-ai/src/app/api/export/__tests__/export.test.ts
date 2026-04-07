// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();

let nextResult: { data: unknown; error: unknown; count?: number } = {
  data: { id: 't1' },
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

vi.mock('@/lib/export/csv', () => ({
  conversationsToCSV: vi.fn(() => 'name,phone\n'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setNext({ data: { id: 't1' }, error: null });
});

describe('/api/export/conversations GET', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { GET } = await import('../conversations/route');
    const req = new NextRequest('http://localhost/api/export/conversations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with text/csv content-type on valid auth', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { GET } = await import('../conversations/route');
    const req = new NextRequest('http://localhost/api/export/conversations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });
});
