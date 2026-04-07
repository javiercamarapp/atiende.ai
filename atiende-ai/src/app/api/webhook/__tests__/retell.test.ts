// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
// Support chained .eq().eq() for (retell_call_id, tenant_id) tenant-scoped updates.
const mockUpdateEqTenant = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockUpdateEq = vi.fn(() => ({
  eq: mockUpdateEqTenant,
  then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
}));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockSelectSingle = vi.fn(() => Promise.resolve({
  data: { tenant_id: 'tid-1', from_number: '+525551234567', to_number: '+525559876543', direction: 'inbound' },
  error: null,
}));
const mockUpsertSelect = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve({ data: { id: 'conv-1' }, error: null })),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'voice_calls') {
        return {
          insert: mockInsert,
          update: mockUpdate,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: mockSelectSingle,
            })),
          })),
        };
      }
      if (table === 'contacts') {
        return { upsert: vi.fn(() => Promise.resolve({ data: null, error: null })) };
      }
      if (table === 'conversations') {
        return { upsert: mockUpsertSelect };
      }
      if (table === 'messages') {
        return { insert: vi.fn(() => Promise.resolve({ data: null, error: null })) };
      }
      return { insert: vi.fn(), update: mockUpdate };
    }),
  },
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: vi.fn(),
}));

import { POST } from '../../webhook/retell/route';
import { logWebhook } from '@/lib/webhook-logger';

const WEBHOOK_SECRET = 'retell-test-secret-123';

function signBody(body: string, secret = WEBHOOK_SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeRetellReq(body: object, opts: { sign?: boolean; signature?: string | null } = {}) {
  const { sign = true, signature } = opts;
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) {
    if (signature !== null) headers['x-retell-signature'] = signature;
  } else if (sign) {
    headers['x-retell-signature'] = signBody(raw);
  }
  return new Request('http://localhost/api/webhook/retell', {
    method: 'POST',
    body: raw,
    headers,
  }) as any;
}

describe('/api/webhook/retell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RETELL_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('returns 401 when no signature is provided', async () => {
    const res = await POST(makeRetellReq({ event: 'call_started' }, { signature: null }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when signature is wrong', async () => {
    const res = await POST(
      makeRetellReq({ event: 'call_started' }, { signature: 'sha256=deadbeef' }),
    );
    expect(res.status).toBe(401);
  });

  it('logs auth_failed on invalid signature', async () => {
    await POST(makeRetellReq({ event: 'test' }, { signature: 'sha256=bad' }));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'retell', eventType: 'auth_failed', statusCode: 401 }),
    );
  });

  it('accepts valid signed webhook', async () => {
    const res = await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c1', metadata: { tenant_id: 'tid-1' }, from_number: '+1', to_number: '+2' },
    ));
    expect(res.status).toBe(200);
  });

  it('creates voice_call record on call_started', async () => {
    await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c3', metadata: { tenant_id: 'tid-1' }, direction: 'inbound', from_number: '+1', to_number: '+2' },
    ));
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tid-1',
        retell_call_id: 'c3',
        direction: 'inbound',
      }),
    );
  });

  it('updates duration on call_ended', async () => {
    await POST(makeRetellReq(
      { event: 'call_ended', call_id: 'c4', duration_ms: 30000, cost: 0.05 },
    ));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_seconds: 30,
        cost_usd: 0.05,
      }),
    );
  });

  it('updates sentiment and summary on call_analyzed', async () => {
    await POST(makeRetellReq(
      {
        event: 'call_analyzed',
        call_id: 'c5',
        call_analysis: { call_summary: 'Patient asked about appointment', user_sentiment: 'positive' },
        recording_url: 'https://example.com/rec.mp3',
      },
    ));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Patient asked about appointment',
        sentiment: 'positive',
        recording_url: 'https://example.com/rec.mp3',
      }),
    );
  });

  it('returns received:true for valid events', async () => {
    const res = await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c6', metadata: { tenant_id: 'tid-1' }, from_number: '+1', to_number: '+2' },
    ));
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('returns 400 on bad JSON body (with valid signature)', async () => {
    const raw = 'not json';
    const req = new Request('http://localhost/api/webhook/retell', {
      method: 'POST',
      body: raw,
      headers: { 'x-retell-signature': signBody(raw) },
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('logs webhook with event type on success', async () => {
    await POST(makeRetellReq(
      { event: 'call_ended', call_id: 'c7', duration_ms: 10000 },
    ));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'retell', eventType: 'call_ended', statusCode: 200 }),
    );
  });
});
