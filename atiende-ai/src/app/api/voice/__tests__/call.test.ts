// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockTenantSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockTenantSingle,
        })),
      })),
    })),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

vi.mock('@/lib/voice/retell', () => ({
  makeOutboundCall: vi.fn(() => Promise.resolve({ call_id: 'call_123' })),
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn(() => Promise.resolve(false)),
}));

import { POST } from '../call/route';

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/voice/call', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/voice/call POST', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await POST(makeReq({ contactPhone: '+5215551234567' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid auth + body', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    mockTenantSingle.mockResolvedValueOnce({
      data: { id: 't1', retell_agent_id: 'agent_1' },
      error: null,
    });
    const res = await POST(makeReq({ contactPhone: '+5215551234567' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.callId).toBe('call_123');
  });

  it('returns 400 when contactPhone missing', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    mockTenantSingle.mockResolvedValueOnce({
      data: { id: 't1', retell_agent_id: 'agent_1' },
      error: null,
    });
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });
});
