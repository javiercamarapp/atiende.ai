import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockUpdateEq = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'audit_log') return { insert: mockInsert };
      return { update: mockUpdate };
    }),
  },
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: vi.fn(),
}));

import { POST } from '../../webhook/conekta/route';
import { logWebhook } from '@/lib/webhook-logger';

const WEBHOOK_KEY = 'test-conekta-key';

function signBody(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_KEY).update(body).digest('hex');
}

function makeConektaReq(body: object, signature?: string) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (signature !== undefined) {
    // Ensure signature is a valid 64-char hex string so timingSafeEqual doesn't throw on length mismatch
    const isValidHex64 = /^[0-9a-f]{64}$/i.test(signature);
    headers['digest'] = isValidHex64 ? signature : 'a'.repeat(64);
  }
  return new Request('http://localhost/api/webhook/conekta', {
    method: 'POST',
    body: raw,
    headers,
  }) as any;
}

describe('/api/webhook/conekta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONEKTA_WEBHOOK_KEY = WEBHOOK_KEY;
  });

  it('returns 401 when signature is invalid', async () => {
    const res = await POST(makeConektaReq({ type: 'order.paid' }, 'invalidsig'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('returns 401 when signature header is missing', async () => {
    const body = { type: 'order.paid' };
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when CONEKTA_WEBHOOK_KEY is not configured', async () => {
    delete process.env.CONEKTA_WEBHOOK_KEY;
    const res = await POST(makeConektaReq({ type: 'order.paid' }, 'sig'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Server misconfiguration');
  });

  it('processes order.paid with valid signature and updates tenant plan', async () => {
    const body = {
      type: 'order.paid',
      data: { object: { id: 'ord_1', metadata: { tenant_id: 'tid-1', plan: 'pro' } } },
    };
    const raw = JSON.stringify(body);
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro' })
    );
  });

  it('processes order.expired and inserts audit_log', async () => {
    const body = {
      type: 'order.expired',
      data: { object: { id: 'ord_2', metadata: { tenant_id: 'tid-2' }, amount: 500, currency: 'MXN' } },
    };
    const raw = JSON.stringify(body);
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tid-2',
        action: 'order.expired',
        entity_type: 'payment',
      })
    );
  });

  it('returns received:true for unknown event types', async () => {
    const body = { type: 'charge.created', data: { object: {} } };
    const raw = JSON.stringify(body);
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('logs webhook with correct event type', async () => {
    const body = { type: 'order.paid', data: { object: { id: 'ord_3', metadata: { tenant_id: 'tid-3', plan: 'basic' } } } };
    const raw = JSON.stringify(body);
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    await POST(req);
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'conekta', eventType: 'order.paid' })
    );
  });

  it('logs auth_failed on invalid signature', async () => {
    await POST(makeConektaReq({ type: 'test' }, 'bad'));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'conekta', eventType: 'auth_failed', statusCode: 401 })
    );
  });

  it('does not update tenant when order.paid has missing metadata', async () => {
    const body = { type: 'order.paid', data: { object: { id: 'ord_4', metadata: {} } } };
    const raw = JSON.stringify(body);
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 on malformed JSON body', async () => {
    const raw = 'not json';
    const sig = signBody(raw);
    const req = new Request('http://localhost/api/webhook/conekta', {
      method: 'POST',
      body: raw,
      headers: { digest: sig },
    }) as any;

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
