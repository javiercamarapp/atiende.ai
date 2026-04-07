// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Chainable supabaseAdmin mock ──────────────────────────────────────
// Each chain method returns the same proxy, which is also a thenable that
// resolves to { data: [], error: null, count: 0 }.
function makeChain() {
  const result = { data: [], error: null, count: 0 };
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => resolve(result);
      }
      return () => chain;
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
  },
}));

// ─── External integrations ─────────────────────────────────────────────
vi.mock('@/lib/whatsapp/send', () => ({
  sendTemplate: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/actions/notifications', () => ({
  notifyOwner: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/marketplace/engine', () => ({
  executeCronAgents: vi.fn(() => Promise.resolve({ executed: 0 })),
}));
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/email/templates', () => ({
  trialEndingEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/integrations/softrestaurant', () => ({
  syncMenuToRAG: vi.fn(() => Promise.resolve(0)),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeReq(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new NextRequest('http://localhost/api/cron/test', { headers });
}

const VALID = 'Bearer test-cron-secret';
const WRONG = 'Bearer wrong';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
});

describe('cron routes auth + happy path', () => {
  it('reminders: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../reminders/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });

  it('daily-briefing: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../daily-briefing/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });

  it('marketplace: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../marketplace/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });

  it('cleanup: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../cleanup/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });

  it('trial-warning: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../trial-warning/route');
    expect((await GET(makeReq(WRONG) as unknown as Request)).status).toBe(401);
    expect((await GET(makeReq(VALID) as unknown as Request)).status).toBe(200);
  });

  it('analytics: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../analytics/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });

  it('sync-menu: 401 wrong secret, 200 valid', async () => {
    const { GET } = await import('../sync-menu/route');
    expect((await GET(makeReq(WRONG))).status).toBe(401);
    expect((await GET(makeReq(VALID))).status).toBe(200);
  });
});
