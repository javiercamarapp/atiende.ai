import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────

const mockSingle = vi.fn();
const mockHead = vi.fn(() => ({ count: 0 }));
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle })) })) })) }));
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 'conv-1', status: 'active', customer_name: null } })) })) }));
const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => ({})) }));
const mockOrder = vi.fn(() => ({ limit: vi.fn(() => ({ data: [] })) }));

function buildChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn(() => ({ limit: vi.fn(() => ({ data: [] })) })),
    single: mockSingle,
    insert: mockInsert,
    update: mockUpdate,
    limit: vi.fn(() => ({ data: [] })),
  };
}

const chainInstance = buildChain();

const mockFrom = vi.fn(() => chainInstance);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));

const mockGenerateResponse = vi.fn(() => ({
  text: 'Hola, con gusto le ayudo.',
  model: 'test-model',
  tokensIn: 10,
  tokensOut: 20,
  cost: 0.001,
}));
const mockSelectModel = vi.fn(() => 'test-model');

vi.mock('@/lib/llm/openrouter', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  selectModel: (...args: unknown[]) => mockSelectModel(...args),
}));

const mockClassifyIntent = vi.fn(() => 'GREETING');
vi.mock('@/lib/llm/classifier', () => ({
  classifyIntent: (...args: unknown[]) => mockClassifyIntent(...args),
}));

const mockSearchKnowledge = vi.fn(() => 'Horario: 9am-6pm');
vi.mock('@/lib/rag/search', () => ({
  searchKnowledge: (...args: unknown[]) => mockSearchKnowledge(...args),
}));

const mockValidateResponse = vi.fn(
  (text: string, _b: unknown, _c: unknown, _d: unknown) => ({ valid: true, text })
);
vi.mock('@/lib/guardrails/validate', () => ({
  validateResponse: (...args: unknown[]) => mockValidateResponse(...args),
}));

const mockSendTextMessage = vi.fn();
const mockMarkAsRead = vi.fn(() => Promise.resolve());
const mockSendTypingIndicator = vi.fn(() => Promise.resolve());
vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: (...args: unknown[]) => mockSendTextMessage(...args),
  markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
  sendTypingIndicator: (...args: unknown[]) => mockSendTypingIndicator(...args),
}));

const mockTranscribeAudio = vi.fn(() => 'transcribed text');
vi.mock('@/lib/voice/deepgram', () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
}));

const mockCheckRateLimit = vi.fn(() => ({ allowed: true }));
const mockCheckTenantLimit = vi.fn(() => ({ allowed: true }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  checkTenantLimit: (...args: unknown[]) => mockCheckTenantLimit(...args),
}));

import { processIncomingMessage } from '../processor';

// ── Helpers ─────────────────────────────────────────────────

const TENANT: Record<string, unknown> = {
  id: 'tenant-1',
  name: 'Clinica Dental Test',
  status: 'active',
  plan: 'pro',
  business_type: 'dental',
  wa_phone_number_id: 'phone-123',
  welcome_message: 'Bienvenido a Clinica Dental Test!',
  chat_system_prompt: 'Eres un asistente dental.',
  temperature: 0.5,
  address: 'Calle 1, Merida',
};

function makeBody(msg: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id: 'msg-1', from: '5219991234567', type: 'text', ...msg }],
              metadata: { phone_number_id: 'phone-123', display_phone_number: '+5219990001111' },
            },
          },
        ],
      },
    ],
  };
}

function setupTenantFound(tenant = TENANT) {
  // tenant lookup
  mockSingle.mockResolvedValueOnce({ data: tenant });
  // contact lookup - not found
  mockSingle.mockResolvedValueOnce({ data: null });
  // contact insert
  mockInsert.mockReturnValueOnce({
    select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 'contact-1', name: null } })) })),
  });
  // conversation lookup - not found (new)
  mockSingle.mockResolvedValueOnce({ data: null });
  // conversation insert
  mockInsert.mockReturnValueOnce({
    select: vi.fn(() => ({
      single: vi.fn(() => ({ data: { id: 'conv-1', status: 'active', customer_name: null } })),
    })),
  });
}

function setupTenantFoundExisting(tenant = TENANT) {
  // tenant
  mockSingle.mockResolvedValueOnce({ data: tenant });
  // contact found
  mockSingle.mockResolvedValueOnce({ data: { id: 'contact-1', name: 'Juan' } });
  // conversation found
  mockSingle.mockResolvedValueOnce({ data: { id: 'conv-1', status: 'active', customer_name: 'Juan' } });
}

// ── Reset ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Reset chain defaults
  chainInstance.select = vi.fn().mockReturnThis();
  chainInstance.eq = vi.fn().mockReturnThis();
  chainInstance.gte = vi.fn().mockReturnThis();
  chainInstance.order = vi.fn(() => ({ limit: vi.fn(() => ({ data: [] })) }));
  chainInstance.single = mockSingle;
  chainInstance.insert = mockInsert;
  chainInstance.update = mockUpdate;

  // defaults
  mockSingle.mockResolvedValue({ data: null });
  mockInsert.mockReturnValue({
    select: vi.fn(() => ({
      single: vi.fn(() => ({ data: { id: 'new-1', status: 'active', customer_name: null } })),
    })),
  });
  mockUpdate.mockReturnValue({ eq: vi.fn(() => ({})) });

  // monthly count head query - return low count
  mockHead.mockReturnValue({ count: 0 });

  mockCheckRateLimit.mockReturnValue({ allowed: true });
  mockCheckTenantLimit.mockReturnValue({ allowed: true });
  mockClassifyIntent.mockReturnValue('GREETING');
  mockSearchKnowledge.mockReturnValue('');
  mockGenerateResponse.mockResolvedValue({
    text: 'Con gusto le ayudo.',
    model: 'test-model',
    tokensIn: 10,
    tokensOut: 20,
    cost: 0.001,
  });
  mockValidateResponse.mockImplementation((text: string) => ({ valid: true, text }));
});

// ── Tests ───────────────────────────────────────────────────

describe('processIncomingMessage', () => {
  it('processes a text message successfully', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola, buenos dias' } }));
    expect(mockMarkAsRead).toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalled();
  });

  it('calls transcribeAudio for audio messages', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'audio', audio: { id: 'audio-123' } }));
    expect(mockTranscribeAudio).toHaveBeenCalledWith('audio-123');
  });

  it('extracts caption from image messages', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({ type: 'image', image: { caption: 'mi diente roto' } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles image without caption', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'image', image: {} }));
    // Should still process with "[Imagen recibida]"
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('extracts filename from document messages', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({ type: 'document', document: { filename: 'receta.pdf' } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('extracts coordinates from location messages', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({ type: 'location', location: { latitude: 20.97, longitude: -89.62 } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('stops processing when tenant is not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('skips AI response when conversation is in human_handoff', async () => {
    // tenant
    mockSingle.mockResolvedValueOnce({ data: TENANT });
    // contact
    mockSingle.mockResolvedValueOnce({ data: { id: 'contact-1', name: 'Juan' } });
    // conversation with human_handoff
    mockSingle.mockResolvedValueOnce({ data: { id: 'conv-1', status: 'human_handoff', customer_name: 'Juan' } });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Necesito ayuda' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    // But message should still be saved
    expect(mockFrom).toHaveBeenCalled();
  });

  it('drops message when phone is rate limited', async () => {
    mockSingle.mockResolvedValueOnce({ data: TENANT });
    mockCheckRateLimit.mockReturnValue({ allowed: false });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('drops message when tenant limit exceeded', async () => {
    mockSingle.mockResolvedValueOnce({ data: TENANT });
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockCheckTenantLimit.mockReturnValue({ allowed: false });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('sends trial ended message when trial expired', async () => {
    const trialTenant = {
      ...TENANT,
      plan: 'free_trial',
      trial_ends_at: '2020-01-01T00:00:00Z',
    };
    mockSingle.mockResolvedValueOnce({ data: trialTenant });
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockCheckTenantLimit.mockReturnValue({ allowed: true });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      expect.stringContaining('periodo de prueba ha terminado')
    );
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('sends plan limit message when monthly count exceeded', async () => {
    const limitedTenant = { ...TENANT, plan: 'basic' };
    mockSingle.mockResolvedValueOnce({ data: limitedTenant });
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockCheckTenantLimit.mockReturnValue({ allowed: true });

    // Override the select chain for monthly count query
    // The from('messages') call for count check returns high count
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnValue({ count: 9999 }),
    };
    mockFrom.mockReturnValueOnce(countChain as any);

    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      expect.stringContaining('limite de mensajes')
    );
  });

  it('sends welcome message for new conversations', async () => {
    setupTenantFound(TENANT);
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      'Bienvenido a Clinica Dental Test!'
    );
  });

  it('classifies intent correctly', async () => {
    setupTenantFoundExisting();
    mockClassifyIntent.mockReturnValue('APPOINTMENT');
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Quiero una cita' } }));
    expect(mockClassifyIntent).toHaveBeenCalledWith('Quiero una cita');
  });

  it('calls RAG search with correct tenant ID', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Cuanto cuesta la limpieza?' } }));
    expect(mockSearchKnowledge).toHaveBeenCalledWith('tenant-1', 'Cuanto cuesta la limpieza?');
  });

  it('selects model using routing rules', async () => {
    setupTenantFoundExisting();
    mockClassifyIntent.mockReturnValue('PRICING');
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Precios' } }));
    expect(mockSelectModel).toHaveBeenCalledWith('PRICING', 'dental', 'pro');
  });

  it('validates response with guardrails', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockValidateResponse).toHaveBeenCalledWith(
      'Con gusto le ayudo.',
      expect.objectContaining({ id: 'tenant-1' }),
      expect.any(String),
      expect.any(String)
    );
  });

  it('saves outbound message to DB', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola que tal' } }));
    // insert is called for inbound + outbound
    expect(mockInsert).toHaveBeenCalled();
  });

  it('updates conversation with last_message_at', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola que tal' } }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_message_at: expect.any(String) })
    );
  });

  it('handles sticker messages', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(makeBody({ type: 'sticker' }));
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles interactive button_reply', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { title: 'Si, agendar' } },
      })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles interactive list_reply', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { title: 'Limpieza dental' } },
      })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('skips status updates (no messages)', async () => {
    const body = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'phone-123', display_phone_number: '+52' } } }] }],
    };
    await processIncomingMessage(body as any);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('handles empty entry array', async () => {
    await processIncomingMessage({ entry: [] });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('sanitizes HTML from input', async () => {
    setupTenantFoundExisting();
    await processIncomingMessage(
      makeBody({ type: 'text', text: { body: '<script>alert("xss")</script>Hola' } })
    );
    // The content passed should be sanitized - no HTML tags
    expect(mockClassifyIntent).toHaveBeenCalledWith(expect.not.stringContaining('<script>'));
  });
});
