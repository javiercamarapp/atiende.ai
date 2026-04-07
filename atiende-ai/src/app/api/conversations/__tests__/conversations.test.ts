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

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: vi.fn(() => makeChain()) },
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn(async () => false),
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setNext({ data: { id: 't1' }, error: null });
});

describe('/api/conversations/send POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../send/route');
    const req = new NextRequest('http://localhost/api/conversations/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 on valid auth + body', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../send/route');
    const body = {
      conversationId: '11111111-1111-4111-8111-111111111111',
      phoneNumberId: 'pn1',
      to: '+5215555555555',
      text: 'hola',
    };
    const req = {
      json: async () => body,
      headers: new Headers(),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('/api/conversations/takeover POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('../takeover/route');
    const req = { json: async () => ({}) } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 on valid auth + body', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const { POST } = await import('../takeover/route');
    const body = {
      conversationId: '11111111-1111-4111-8111-111111111111',
      action: 'takeover',
    };
    const req = { json: async () => body } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
