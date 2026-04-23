import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── vi.hoisted mock functions ──────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const mockTrackVoiceCall = vi.fn();
  const mockSendTextMessageSafe = vi.fn();
  const mockLogWebhook = vi.fn();

  // Chainable supabase helpers
  const mockInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const mockUpdateEq = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockUpsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const mockUpsertSelectSingle = vi.fn(() =>
    Promise.resolve({ data: { id: 'conv-001' }, error: null }),
  );
  const mockUpsertSelect = vi.fn(() => ({
    select: vi.fn(() => ({ single: mockUpsertSelectSingle })),
  }));
  const mockSelectEqSingle = vi.fn(() =>
    Promise.resolve({
      data: {
        tenant_id: 'tenant-abc',
        from_number: '+525551112222',
        to_number: '+525553334444',
        direction: 'inbound',
      },
      error: null,
    }),
  );
  const mockSelectEqMaybeSingle = vi.fn(() =>
    Promise.resolve({
      data: {
        wa_phone_number_id: 'waba-123',
        phone: '+525550001111',
        name: 'Consultorio Test',
      },
      error: null,
    }),
  );
  const mockMessagesInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));

  return {
    mockTrackVoiceCall,
    mockSendTextMessageSafe,
    mockLogWebhook,
    mockInsert,
    mockUpdate,
    mockUpdateEq,
    mockUpsert,
    mockUpsertSelect,
    mockUpsertSelectSingle,
    mockSelectEqSingle,
    mockSelectEqMaybeSingle,
    mockMessagesInsert,
  };
});

// ─── vi.mock declarations ───────────────────────────────────────────────────
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'voice_calls') {
        return {
          insert: mocks.mockInsert,
          update: mocks.mockUpdate,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: mocks.mockSelectEqSingle,
            })),
          })),
        };
      }
      if (table === 'tenants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: mocks.mockSelectEqMaybeSingle,
            })),
          })),
        };
      }
      if (table === 'contacts') {
        return { upsert: mocks.mockUpsert };
      }
      if (table === 'conversations') {
        return { upsert: mocks.mockUpsertSelect };
      }
      if (table === 'messages') {
        return { insert: mocks.mockMessagesInsert };
      }
      if (table === 'webhook_logs') {
        return { insert: vi.fn(() => Promise.resolve({ data: null, error: null })) };
      }
      return {
        insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: mocks.mockUpdate,
      };
    }),
  },
}));

vi.mock('@/lib/billing/voice-tracker', () => ({
  trackVoiceCall: (...args: unknown[]) => mocks.mockTrackVoiceCall(...args),
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessageSafe: (...args: unknown[]) => mocks.mockSendTextMessageSafe(...args),
}));

vi.mock('@/lib/webhook-logger', () => ({
  logWebhook: (...args: unknown[]) => mocks.mockLogWebhook(...args),
  enforceWebhookSize: () => ({ ok: true }),
  enforceWebhookSizePostRead: () => ({ ok: true }),
  WEBHOOK_MAX_BYTES: 2 * 1024 * 1024,
}));

vi.mock('@/lib/config', () => ({
  VOICE_ALERT_THRESHOLD_PERCENT: 80,
  VOICE_OVERAGE_PRICE_MXN: 5,
}));

vi.mock('@upstash/redis', () => ({
  Redis: class FakeRedis {
    set = vi.fn(() => Promise.resolve('OK'));
  },
}));

// ─── Import route AFTER mocks ──────────────────────────────────────────────
import { POST } from '../../webhook/retell/route';

// ─── Helpers ────────────────────────────────────────────────────────────────
const API_KEY = 'test-retell-key-abc';

function makeReq(
  body: Record<string, unknown>,
  auth?: { bearer?: string; legacy?: string },
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth?.bearer) {
    headers['authorization'] = `Bearer ${auth.bearer}`;
  }
  if (auth?.legacy) {
    headers['x-retell-api-key'] = auth.legacy;
  }
  return new NextRequest('http://localhost/api/webhook/retell', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

/** Standard voice-usage result for billing within included minutes. */
function usageResult(overrides: Partial<{
  minutesUsed: number;
  totalThisMonth: number;
  included: number;
  overage: number;
  isOverage: boolean;
  percentUsed: number;
  remaining: number;
}> = {}) {
  return {
    minutesUsed: 2,
    totalThisMonth: 50,
    included: 300,
    overage: 0,
    isOverage: false,
    percentUsed: 17,
    remaining: 250,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Retell webhook integration: billing + transcript flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RETELL_API_KEY = API_KEY;
    // Leave UPSTASH_REDIS_URL/TOKEN unset so getRedis() returns null
    // and shouldSendAlert() falls through to fail-open (returns true).
    delete process.env.UPSTASH_REDIS_URL;
    delete process.env.UPSTASH_REDIS_TOKEN;

    // Sensible defaults that most tests rely on
    mocks.mockTrackVoiceCall.mockResolvedValue(usageResult());
    mocks.mockSendTextMessageSafe.mockResolvedValue({ ok: true });
  });

  // ─── 1. Auth: 401 without valid auth header ───────────────────────────────
  it('returns 401 without a valid auth header', async () => {
    const res = await POST(makeReq({ event: 'call_started', call_id: 'c1' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  // ─── 2. Auth: accepts Bearer token ────────────────────────────────────────
  it('accepts Bearer token matching RETELL_API_KEY', async () => {
    const res = await POST(
      makeReq(
        { event: 'call_started', call_id: 'c2', metadata: { tenant_id: 'tid' }, from_number: '+1', to_number: '+2' },
        { bearer: API_KEY },
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  // ─── 3. Auth: accepts legacy x-retell-api-key header ─────────────────────
  it('accepts legacy x-retell-api-key header', async () => {
    const res = await POST(
      makeReq(
        { event: 'call_started', call_id: 'c3', metadata: { tenant_id: 'tid' }, from_number: '+1', to_number: '+2' },
        { legacy: API_KEY },
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  // ─── 4. call_started: inserts voice_calls record ──────────────────────────
  it('call_started inserts a voice_calls record with tenant_id and call metadata', async () => {
    await POST(
      makeReq(
        {
          event: 'call_started',
          call_id: 'call-100',
          metadata: { tenant_id: 'tenant-abc' },
          direction: 'inbound',
          from_number: '+525551112222',
          to_number: '+525553334444',
        },
        { bearer: API_KEY },
      ),
    );

    expect(mocks.mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-abc',
        retell_call_id: 'call-100',
        direction: 'inbound',
        from_number: '+525551112222',
        to_number: '+525553334444',
      }),
    );
  });

  // ─── 5. call_ended: tracks billing + stores transcript ────────────────────
  it('call_ended tracks billing via trackVoiceCall and stores transcript', async () => {
    mocks.mockTrackVoiceCall.mockResolvedValue(usageResult({ minutesUsed: 3, percentUsed: 20 }));

    const res = await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-200',
          duration_ms: 180_000,
          cost: 0.12,
          metadata: { tenant_id: 'tenant-abc' },
          transcript: 'Hola, quiero agendar una cita.',
          transcript_object: [{ role: 'user', content: 'Hola, quiero agendar una cita.' }],
        },
        { legacy: API_KEY },
      ),
    );

    expect(res.status).toBe(200);

    // trackVoiceCall was invoked with correct args
    expect(mocks.mockTrackVoiceCall).toHaveBeenCalledWith('tenant-abc', 'call-200', 180);

    // Supabase update includes transcript + duration
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_seconds: 180,
        cost_usd: 0.12,
        transcript: 'Hola, quiero agendar una cita.',
        transcript_segments: [{ role: 'user', content: 'Hola, quiero agendar una cita.' }],
      }),
    );
    expect(mocks.mockUpdateEq).toHaveBeenCalledWith('retell_call_id', 'call-200');
  });

  // ─── 6. call_ended: warning alert at 80% threshold ───────────────────────
  it('call_ended sends warning alert when usage passes 80% threshold', async () => {
    mocks.mockTrackVoiceCall.mockResolvedValue(
      usageResult({
        minutesUsed: 5,
        totalThisMonth: 245,
        percentUsed: 82,
        remaining: 55,
        isOverage: false,
        overage: 0,
      }),
    );

    await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-warn',
          duration_ms: 300_000,
          metadata: { tenant_id: 'tenant-abc' },
        },
        { bearer: API_KEY },
      ),
    );

    // sendTextMessageSafe was called with warning text
    expect(mocks.mockSendTextMessageSafe).toHaveBeenCalledTimes(1);
    const [wabaId, phone, text] = mocks.mockSendTextMessageSafe.mock.calls[0];
    expect(wabaId).toBe('waba-123');
    expect(phone).toBe('+525550001111');
    expect(text).toContain('Aviso de uso de voz');
    expect(text).toContain('82%');
    expect(text).toContain('55 minutos');
    expect(text).toContain('$5 MXN');
  });

  // ─── 7. call_ended: overage alert ────────────────────────────────────────
  it('call_ended sends overage alert when usage exceeds included minutes', async () => {
    mocks.mockTrackVoiceCall.mockResolvedValue(
      usageResult({
        minutesUsed: 3,
        totalThisMonth: 315,
        included: 300,
        percentUsed: 105,
        remaining: 0,
        isOverage: true,
        overage: 15,
      }),
    );

    await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-over',
          duration_ms: 180_000,
          metadata: { tenant_id: 'tenant-abc' },
        },
        { bearer: API_KEY },
      ),
    );

    expect(mocks.mockSendTextMessageSafe).toHaveBeenCalledTimes(1);
    const [, , text] = mocks.mockSendTextMessageSafe.mock.calls[0];
    expect(text).toContain('Minutos adicionales activos');
    expect(text).toContain('300 minutos incluidos');
    // 15 overage → ceil(15) = 15, 15 × $5 = $75
    expect(text).toContain('Minutos extra este mes: 15');
    expect(text).toContain('$75 MXN');
  });

  // ─── 8. call_ended: creates contact + conversation + message ──────────────
  it('call_ended creates contact, conversation, and message from transcript', async () => {
    mocks.mockTrackVoiceCall.mockResolvedValue(usageResult({ percentUsed: 10 }));

    await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-conv',
          duration_ms: 60_000,
          metadata: { tenant_id: 'tenant-abc' },
          transcript: 'Necesito una consulta para el lunes.',
        },
        { bearer: API_KEY },
      ),
    );

    // Upsert contact with customer phone (from_number for inbound)
    expect(mocks.mockUpsert).toHaveBeenCalledWith(
      { tenant_id: 'tenant-abc', phone: '+525551112222' },
      { onConflict: 'tenant_id,phone' },
    );

    // Upsert conversation with channel = voice
    expect(mocks.mockUpsertSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-abc',
        customer_phone: '+525551112222',
        channel: 'voice',
      }),
      { onConflict: 'tenant_id,customer_phone,channel' },
    );

    // Insert message with transcript content
    expect(mocks.mockMessagesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-001',
        tenant_id: 'tenant-abc',
        direction: 'inbound',
        sender_type: 'customer',
        content: 'Necesito una consulta para el lunes.',
        message_type: 'voice_transcript',
      }),
    );
  });

  // ─── 9. call_analyzed: updates summary, sentiment, outcome, recording_url ─
  it('call_analyzed updates summary, sentiment, outcome, and recording_url', async () => {
    await POST(
      makeReq(
        {
          event: 'call_analyzed',
          call_id: 'call-analyzed',
          call_analysis: {
            call_summary: 'Patient requested Monday appointment.',
            user_sentiment: 'positive',
            custom_analysis: { outcome: 'appointment_booked' },
          },
          recording_url: 'https://storage.retell.ai/rec-123.mp3',
        },
        { bearer: API_KEY },
      ),
    );

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Patient requested Monday appointment.',
        sentiment: 'positive',
        outcome: 'appointment_booked',
        recording_url: 'https://storage.retell.ai/rec-123.mp3',
      }),
    );
    expect(mocks.mockUpdateEq).toHaveBeenCalledWith('retell_call_id', 'call-analyzed');
  });

  // ─── 10. Dedup: duplicate retell_call_id doesn't double-count ─────────────
  it('duplicate retell_call_id does not double-count when trackVoiceCall returns minutesUsed: 0', async () => {
    // Simulates the dedup path: voice_call_logs insert hits unique constraint,
    // trackVoiceCall returns minutesUsed: 0 to signal already counted.
    mocks.mockTrackVoiceCall.mockResolvedValue(
      usageResult({
        minutesUsed: 0,
        totalThisMonth: 50,
        percentUsed: 17,
        isOverage: false,
        overage: 0,
      }),
    );

    // First call
    await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-dup',
          duration_ms: 120_000,
          metadata: { tenant_id: 'tenant-abc' },
        },
        { bearer: API_KEY },
      ),
    );

    // Second call with same call_id
    const res = await POST(
      makeReq(
        {
          event: 'call_ended',
          call_id: 'call-dup',
          duration_ms: 120_000,
          metadata: { tenant_id: 'tenant-abc' },
        },
        { bearer: API_KEY },
      ),
    );

    expect(res.status).toBe(200);
    // trackVoiceCall was called both times (the dedup is internal to trackVoiceCall)
    expect(mocks.mockTrackVoiceCall).toHaveBeenCalledTimes(2);
    // But since percentUsed < 80 and isOverage is false, no alert was sent
    expect(mocks.mockSendTextMessageSafe).not.toHaveBeenCalled();
  });
});
