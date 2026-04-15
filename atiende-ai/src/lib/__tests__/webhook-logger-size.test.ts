import { describe, it, expect, vi } from 'vitest';

// AUDIT R17 BUG-002: tests del size cap de webhooks.

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    }),
  },
}));

import {
  enforceWebhookSize,
  enforceWebhookSizePostRead,
  WEBHOOK_MAX_BYTES,
} from '../webhook-logger';

describe('enforceWebhookSize', () => {
  it('rechaza payload con content-length > maxBytes (413)', () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': String(3 * 1024 * 1024) },
      body: '',
    });
    const result = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'whatsapp', Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
    }
  });

  it('acepta payload dentro del límite', () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': '500' },
      body: '{"test":true}',
    });
    const result = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'whatsapp', Date.now());
    expect(result.ok).toBe(true);
  });

  it('acepta cuando content-length header falta (se valida post-read)', () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      body: '{}',
    });
    const result = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'stripe', Date.now());
    expect(result.ok).toBe(true);
  });

  it('rechaza exactamente en el límite + 1', () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': String(WEBHOOK_MAX_BYTES + 1) },
      body: '',
    });
    const result = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'conekta', Date.now());
    expect(result.ok).toBe(false);
  });

  it('acepta exactamente en el límite', () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': String(WEBHOOK_MAX_BYTES) },
      body: '',
    });
    const result = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'retell', Date.now());
    expect(result.ok).toBe(true);
  });
});

describe('enforceWebhookSizePostRead', () => {
  it('rechaza si el buffer real excede aunque content-length mintió', () => {
    const result = enforceWebhookSizePostRead(
      3 * 1024 * 1024,
      WEBHOOK_MAX_BYTES,
      'delivery',
      Date.now(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
    }
  });

  it('acepta si el buffer real está dentro del límite', () => {
    const result = enforceWebhookSizePostRead(
      1024,
      WEBHOOK_MAX_BYTES,
      'delivery',
      Date.now(),
    );
    expect(result.ok).toBe(true);
  });
});

describe('WEBHOOK_MAX_BYTES', () => {
  it('es 2MB', () => {
    expect(WEBHOOK_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
