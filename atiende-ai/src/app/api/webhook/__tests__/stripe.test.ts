import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
const mockSelect = vi.fn(() => ({
  eq: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve({ data: { id: 'tenant-1' }, error: null })),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'tenants') {
        return { update: mockUpdate, select: mockSelect };
      }
      return { update: mockUpdate, select: mockSelect };
    }),
  },
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: vi.fn(),
}));

const mockConstructEvent = vi.fn();

vi.mock('@/lib/billing/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
    },
  },
}));

import { POST } from '../../webhook/stripe/route';
import { logWebhook } from '@/lib/webhook-logger';

function makeStripeReq(body: string, sig = 'whsec_test_sig') {
  return new Request('http://localhost/api/webhook/stripe', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': sig },
  }) as any;
}

describe('/api/webhook/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('returns 400 when signature is invalid', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Invalid signature'); });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid sig');
  });

  it('logs auth_failed on invalid signature', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Invalid'); });
    await POST(makeStripeReq('{}'));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'stripe', eventType: 'auth_failed', statusCode: 400 })
    );
  });

  it('processes checkout.session.completed and updates tenant plan', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { tenant_id: 'tenant-1', plan: 'pro' },
          customer: 'cus_123',
        },
      },
    });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', stripe_customer_id: 'cus_123' })
    );
  });

  it('processes customer.subscription.deleted and downgrades tenant', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'customer.subscription.deleted',
      data: {
        object: { customer: 'cus_456' },
      },
    });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free_trial', status: 'paused' })
    );
  });

  it('returns received:true for unknown event types', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'invoice.paid',
      data: { object: {} },
    });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('logs webhook with event type', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_4',
      type: 'invoice.paid',
      data: { object: {} },
    });
    await POST(makeStripeReq('{}'));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'stripe', eventType: 'invoice.paid', statusCode: 200 })
    );
  });

  it('does not update tenant when checkout metadata is missing', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_5',
      type: 'checkout.session.completed',
      data: { object: { metadata: {} } },
    });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(200);
    // update should NOT have been called for tenant plan
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ plan: expect.any(String), stripe_customer_id: expect.any(String) })
    );
  });

  it('extracts tenant_id from metadata in log', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_6',
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { tenant_id: 'tid-999' } } },
    });
    await POST(makeStripeReq('{}'));
    expect(logWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tid-999' })
    );
  });

  it('handles constructEvent returning event with no metadata', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_7',
      type: 'charge.succeeded',
      data: { object: { amount: 1000 } },
    });
    const res = await POST(makeStripeReq('{}'));
    expect(res.status).toBe(200);
  });

  it('returns JSON with received true for valid events', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_8',
      type: 'customer.created',
      data: { object: {} },
    });
    const res = await POST(makeStripeReq('{}'));
    const json = await res.json();
    expect(json).toEqual({ received: true });
  });
});
