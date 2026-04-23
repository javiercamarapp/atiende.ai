/* eslint-disable @typescript-eslint/no-explicit-any -- Request-to-NextRequest casts required throughout test */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock dependencies
vi.mock('@/lib/whatsapp/processor', () => ({
  processIncomingMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: vi.fn(),
  // AUDIT R17: size cap helpers. Mockeamos con delegación a los reales para
  // no duplicar la lógica; los tests de unit viven en webhook-logger.test.ts.
  enforceWebhookSize: (req: Request, maxBytes: number) => {
    const cl = Number(req.headers.get('content-length') || '0');
    if (cl > 0 && cl > maxBytes) {
      return { ok: false, response: new Response('Payload too large', { status: 413 }) };
    }
    return { ok: true };
  },
  enforceWebhookSizePostRead: (byteLength: number, maxBytes: number) => {
    if (byteLength > maxBytes) {
      return { ok: false, response: new Response('Payload too large', { status: 413 }) };
    }
    return { ok: true };
  },
  WEBHOOK_MAX_BYTES: 2 * 1024 * 1024,
}));

const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ then: vi.fn((cb: () => void) => cb()) })) }));
// AUDIT P1 item 1 — webhook ahora hace idempotency multi-message vía
// `supabaseAdmin.from('messages').select('wa_message_id').in(...)`. El mock
// debe soportar esa cadena además de .update().eq(). Por default `in()`
// retorna `{ data: [], error: null }` (ningún duplicado) → el webhook
// continúa al worker normal.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      update: mockUpdate,
      select: vi.fn(() => ({
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}));

// AUDIT P1 item 4 — checkApiRateLimit default a false (no rate-limited).
vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn(() => Promise.resolve(false)),
}));

// AUDIT P1/P2 — QStash no configurado en tests, fallback a waitUntil.
vi.mock('@/lib/queue/qstash', () => ({
  isQStashConfigured: () => false,
  publishMessage: vi.fn(),
}));

import { GET, POST } from '../../webhook/whatsapp/route';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { logWebhook } from '@/lib/webhook-logger';

function makeRequest(url: string, init?: RequestInit) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cast Request to NextRequest for test
  const req = new Request(url, init) as any;
  const parsedUrl = new URL(url);
  req.nextUrl = {
    pathname: parsedUrl.pathname,
    searchParams: parsedUrl.searchParams,
  };
  return req;
}

function signPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('/api/webhook/whatsapp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WA_VERIFY_TOKEN = 'test-verify-token';
    process.env.WA_APP_SECRET = 'test-app-secret';
  });

  // ─── GET (Verification) ─────────────────────────────────────
  describe('GET - webhook verification', () => {
    it('returns challenge when verify token is valid', async () => {
      const url = 'http://localhost/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('challenge123');
    });

    it('returns 403 when verify token is invalid', async () => {
      const url = 'http://localhost/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge123';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(403);
    });

    it('returns 403 when hub.mode is not subscribe', async () => {
      const url = 'http://localhost/api/webhook/whatsapp?hub.mode=other&hub.verify_token=test-verify-token&hub.challenge=c';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(403);
    });

    it('returns 403 when parameters are missing', async () => {
      const url = 'http://localhost/api/webhook/whatsapp';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(403);
    });

    it('returns 403 when only hub.mode is provided', async () => {
      const url = 'http://localhost/api/webhook/whatsapp?hub.mode=subscribe';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(403);
    });

    it('returns 403 when verify_token is empty string', async () => {
      const url = 'http://localhost/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=c';
      const res = await GET(makeRequest(url));
      expect(res.status).toBe(403);
    });
  });

  // ─── POST ────────────────────────────────────────────────────
  describe('POST - message processing', () => {
    // AUDIT P2 item 6: payload debe pasar validación Zod. Campos requeridos:
    // - metadata.phone_number_id: 10-20 dígitos
    // - messages[].id, from, type, timestamp (unix seconds, 8-12 dígitos)
    //
    // AUDIT P1 item 3: timestamp debe ser reciente (< 5 min) para no
    // dispararse replay protection. Calculado en cada test con Date.now().
    const recentTimestamp = () => String(Math.floor(Date.now() / 1000));
    const messagePayload = () => ({
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: '1234567890' },
            messages: [{
              id: 'msg-1',
              from: '5219991234567',
              type: 'text',
              timestamp: recentTimestamp(),
              text: { body: 'Hola' },
            }],
          },
        }],
      }],
    });

    function postWithSignature(body: object | string, headers: Record<string, string> = {}) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      const sig = signPayload(raw, process.env.WA_APP_SECRET!);
      return new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: raw,
        headers: { 'x-hub-signature-256': sig, ...headers },
      }) as any;
    }

    // AUDIT R17 BUG-002: size cap en la puerta
    it('rechaza payload con content-length > 2MB (413) sin invocar processor', async () => {
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: '{}',
        headers: { 'content-length': String(3 * 1024 * 1024) },
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(413);
      expect(processIncomingMessage).not.toHaveBeenCalled();
    });

    it('processes valid signed message and returns 200', async () => {
      const req = postWithSignature(messagePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('processing');
      expect(processIncomingMessage).toHaveBeenCalled();
    });

    it('returns 401 when signature is invalid', async () => {
      const raw = JSON.stringify(messagePayload());
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: raw,
        headers: { 'x-hub-signature-256': 'sha256=invalidsignature1234567890abcdef1234567890abcdef1234567890abcdef' },
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when signature header is missing', async () => {
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: JSON.stringify(messagePayload()),
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('logs webhook on missing signature', async () => {
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: JSON.stringify(messagePayload()),
      }) as any;
      await POST(req);
      expect(logWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'whatsapp', eventType: 'auth_failed', statusCode: 401 })
      );
    });

    it('processes status update (delivered)', async () => {
      const statusPayload = {
        entry: [{
          changes: [{
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1234567890' },
              statuses: [{ id: 'wamid.xxx', status: 'delivered', timestamp: '1700000000' }],
            },
          }],
        }],
      };
      const req = postWithSignature(statusPayload);
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ wa_status: 'delivered' })
      );
    });

    it('processes status update (read)', async () => {
      const statusPayload = {
        entry: [{
          changes: [{
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1234567890' },
              statuses: [{ id: 'wamid.yyy', status: 'read', timestamp: '1700000000' }],
            },
          }],
        }],
      };
      const req = postWithSignature(statusPayload);
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ wa_status: 'read' })
      );
    });

    it('rejects with 500 when WA_APP_SECRET is not configured (signature is mandatory)', async () => {
      // Security fix: previously, missing WA_APP_SECRET skipped verification
      // entirely, letting anyone POST to the endpoint. Now it must be set.
      delete process.env.WA_APP_SECRET;
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: JSON.stringify(messagePayload()),
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(500);
    });

    // AUDIT P1 item 2 — JSON.parse envuelto en try/catch. Ahora retornamos
    // 200 con `status:'invalid_json'` para que Meta no reintente el mismo
    // payload malformado.
    it('returns 200 with invalid_json status on malformed body (no Meta retry)', async () => {
      const raw = 'not valid json';
      const sig = signPayload(raw, process.env.WA_APP_SECRET!);
      const req = new Request('http://localhost/api/webhook/whatsapp', {
        method: 'POST',
        body: raw,
        headers: { 'x-hub-signature-256': sig },
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('invalid_json');
      expect(processIncomingMessage).not.toHaveBeenCalled();
    });

    it('returns received even if processIncomingMessage rejects', async () => {
      vi.mocked(processIncomingMessage).mockRejectedValueOnce(new Error('fail'));
      const req = postWithSignature(messagePayload());
      const res = await POST(req);
      // Route returns 200 immediately, error handled in background
      expect(res.status).toBe(200);
    });
  });
});
