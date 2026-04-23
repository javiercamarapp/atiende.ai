import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockUpdateEq = vi.fn(() => Promise.resolve({ data: null, error: null }));
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
  enforceWebhookSize: () => ({ ok: true }),
  enforceWebhookSizePostRead: () => ({ ok: true }),
  WEBHOOK_MAX_BYTES: 2 * 1024 * 1024,
}));

import { POST } from '../webhook/retell/route';
import { logWebhook } from '@/lib/webhook-logger';

const API_KEY = 'retell-test-key-123';

function makeRetellReq(body: object, apiKey?: string, useBearerAuth = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== undefined) {
    if (useBearerAuth) {
      headers['authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['x-retell-api-key'] = apiKey;
    }
  }
  return new Request('http://localhost/api/webhook/retell', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  }) as any;
}

describe('/api/webhook/retell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RETELL_API_KEY = API_KEY;
  });

  it('returns 401 when no API key is provided', async () => {
    const res = await POST(makeRetellReq({ event: 'call_started' }));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toBe('Unauthorized');
  });

  it('returns 401 when API key is wrong', async () => {
    const res = await POST(makeRetellReq({ event: 'call_started' }, 'wrong-key'));
    expect(res.status).toBe(401);
  });

  it('logs auth_failed on invalid API key', async () => {
    await POST(makeRetellReq({ event: 'test' }, 'wrong'));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'retell', eventType: 'auth_failed', statusCode: 401 })
    );
  });

  it('accepts valid x-retell-api-key header', async () => {
    const res = await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c1', metadata: { tenant_id: 'tid-1' }, from_number: '+1', to_number: '+2' },
      API_KEY,
    ));
    expect(res.status).toBe(200);
  });

  it('accepts valid Bearer authorization header', async () => {
    const res = await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c2', metadata: { tenant_id: 'tid-1' }, from_number: '+1', to_number: '+2' },
      API_KEY,
      true,
    ));
    expect(res.status).toBe(200);
  });

  it('creates voice_call record on call_started', async () => {
    await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c3', metadata: { tenant_id: 'tid-1' }, direction: 'inbound', from_number: '+1', to_number: '+2' },
      API_KEY,
    ));
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tid-1',
        retell_call_id: 'c3',
        direction: 'inbound',
      })
    );
  });

  it('updates duration on call_ended', async () => {
    await POST(makeRetellReq(
      { event: 'call_ended', call_id: 'c4', duration_ms: 30000, cost: 0.05 },
      API_KEY,
    ));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_seconds: 30,
        cost_usd: 0.05,
      })
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
      API_KEY,
    ));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Patient asked about appointment',
        sentiment: 'positive',
        recording_url: 'https://example.com/rec.mp3',
      })
    );
  });

  it('returns received:true for valid events', async () => {
    const res = await POST(makeRetellReq(
      { event: 'call_started', call_id: 'c6', metadata: { tenant_id: 'tid-1' }, from_number: '+1', to_number: '+2' },
      API_KEY,
    ));
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('returns 400 on bad JSON body', async () => {
    const req = new Request('http://localhost/api/webhook/retell', {
      method: 'POST',
      body: 'not json',
      headers: { 'x-retell-api-key': API_KEY },
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('logs webhook with event type on success', async () => {
    await POST(makeRetellReq(
      { event: 'call_ended', call_id: 'c7', duration_ms: 10000 },
      API_KEY,
    ));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'retell', eventType: 'call_ended', statusCode: 200 })
    );
  });
});
