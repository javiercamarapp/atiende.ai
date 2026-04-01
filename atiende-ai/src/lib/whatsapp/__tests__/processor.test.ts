import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────

// Track per-table mock behavior
let tenantResult: any = { data: null };
let contactResult: any = { data: null };
let conversationResult: any = { data: null };
let monthlyCountResult: any = { count: 0 };
let messagesHistory: any = { data: [] };

const mockInsertMessages = vi.fn(() => ({
  select: vi.fn(() => ({ single: vi.fn(() => ({ data: null })) })),
}));
const mockInsertContacts = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => ({ data: { id: 'contact-1', name: null } })),
  })),
}));
const mockInsertConversations = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => ({ data: { id: 'conv-1', status: 'active', customer_name: null } })),
  })),
}));
const mockUpdateConversations = vi.fn(() => ({ eq: vi.fn() }));

function makeChainable(terminalValue: () => any) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockImplementation(() => terminalValue());
  chain.order = vi.fn().mockReturnValue({ limit: vi.fn().mockImplementation(() => messagesHistory) });
  chain.limit = vi.fn().mockReturnValue({ data: [] });
  chain.single = vi.fn().mockImplementation(() => terminalValue());
  chain.insert = vi.fn().mockReturnValue({
    select: vi.fn(() => ({ single: vi.fn(() => ({ data: null })) })),
  });
  chain.update = vi.fn().mockReturnValue({ eq: vi.fn() });
  return chain;
}

// Call counters to track which single() call we're on per table
let tenantSingleCount = 0;
let contactSingleCount = 0;
let conversationSingleCount = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'tenants') {
        const chain = makeChainable(() => tenantResult);
        return chain;
      }
      if (table === 'contacts') {
        const chain = makeChainable(() => contactResult);
        chain.insert = mockInsertContacts;
        return chain;
      }
      if (table === 'conversations') {
        const chain = makeChainable(() => conversationResult);
        chain.insert = mockInsertConversations;
        chain.update = mockUpdateConversations;
        return chain;
      }
      if (table === 'messages') {
        const chain = makeChainable(() => monthlyCountResult);
        chain.insert = mockInsertMessages;
        chain.order = vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => messagesHistory),
        });
        return chain;
      }
      return makeChainable(() => ({ data: null }));
    },
  },
}));

const mockGenerateResponse = vi.fn(() => ({
  text: 'Con gusto le ayudo.',
  model: 'test-model',
  tokensIn: 10,
  tokensOut: 20,
  cost: 0.001,
}));
const mockSelectModel = vi.fn(() => 'test-model');

vi.mock('@/lib/llm/openrouter', () => ({
  generateResponse: () => mockGenerateResponse(),
  selectModel: () => mockSelectModel(),
}));

const mockClassifyIntent = vi.fn(() => 'GREETING');
vi.mock('@/lib/llm/classifier', () => ({
  classifyIntent: () => mockClassifyIntent(),
}));

const mockSearchKnowledge = vi.fn(() => '');
vi.mock('@/lib/rag/search', () => ({
  searchKnowledge: () => mockSearchKnowledge(),
}));

const mockValidateResponse = vi.fn(
  (text: string) => ({ valid: true, text })
);
vi.mock('@/lib/guardrails/validate', () => ({
  validateResponse: (t: string) => mockValidateResponse(t),
}));

const mockSendTextMessage = vi.fn();
const mockMarkAsRead = vi.fn(() => Promise.resolve());
const mockSendTypingIndicator = vi.fn(() => Promise.resolve());
vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: () => mockSendTextMessage(),
  markAsRead: () => mockMarkAsRead(),
  sendTypingIndicator: () => mockSendTypingIndicator(),
}));

const mockTranscribeAudio = vi.fn(() => 'transcribed text');
vi.mock('@/lib/voice/deepgram', () => ({
  transcribeAudio: () => mockTranscribeAudio(),
}));

const mockCheckRateLimit = vi.fn(() => ({ allowed: true }));
const mockCheckTenantLimit = vi.fn(() => ({ allowed: true }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => mockCheckRateLimit(),
  checkTenantLimit: () => mockCheckTenantLimit(),
}));

import { processIncomingMessage } from '../processor';

// ── Helpers ─────────────────────────────────────────────────

const TENANT = {
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
    entry: [{
      changes: [{
        value: {
          messages: [{ id: 'msg-1', from: '5219991234567', type: 'text', ...msg }],
          metadata: { phone_number_id: 'phone-123', display_phone_number: '+5219990001111' },
        },
      }],
    }],
  };
}

/** Sets up mocks for an existing contact + existing conversation */
function setupExisting(tenant = TENANT) {
  tenantResult = { data: tenant };
  contactResult = { data: { id: 'contact-1', name: 'Juan' } };
  conversationResult = { data: { id: 'conv-1', status: 'active', customer_name: 'Juan' } };
  monthlyCountResult = { count: 0 };
}

/** Sets up mocks for a new contact + new conversation */
function setupNew(tenant = TENANT) {
  tenantResult = { data: tenant };
  contactResult = { data: null };
  conversationResult = { data: null };
  monthlyCountResult = { count: 0 };
}

// ── Reset ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  tenantResult = { data: null };
  contactResult = { data: null };
  conversationResult = { data: null };
  monthlyCountResult = { count: 0 };
  messagesHistory = { data: [] };

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
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola, buenos dias' } }));
    expect(mockMarkAsRead).toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalled();
  });

  it('calls transcribeAudio for audio messages', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'audio', audio: { id: 'audio-123' } }));
    expect(mockTranscribeAudio).toHaveBeenCalledWith('audio-123');
  });

  it('extracts caption from image messages', async () => {
    setupExisting();
    await processIncomingMessage(
      makeBody({ type: 'image', image: { caption: 'mi diente roto' } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles image without caption', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'image', image: {} }));
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('extracts filename from document messages', async () => {
    setupExisting();
    await processIncomingMessage(
      makeBody({ type: 'document', document: { filename: 'receta.pdf' } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('extracts coordinates from location messages', async () => {
    setupExisting();
    await processIncomingMessage(
      makeBody({ type: 'location', location: { latitude: 20.97, longitude: -89.62 } })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('stops processing when tenant is not found', async () => {
    tenantResult = { data: null };
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('skips AI response when conversation is in human_handoff', async () => {
    setupExisting();
    conversationResult = { data: { id: 'conv-1', status: 'human_handoff', customer_name: 'Juan' } };
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Necesito ayuda' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    // But message should still be saved
    expect(mockInsertMessages).toHaveBeenCalled();
  });

  it('drops message when phone is rate limited', async () => {
    setupExisting();
    mockCheckRateLimit.mockReturnValue({ allowed: false });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('drops message when tenant limit exceeded', async () => {
    setupExisting();
    mockCheckTenantLimit.mockReturnValue({ allowed: false });
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('sends trial ended message when trial expired', async () => {
    setupExisting({
      ...TENANT,
      plan: 'free_trial',
      trial_ends_at: '2020-01-01T00:00:00Z',
    } as any);
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      expect.stringContaining('periodo de prueba ha terminado')
    );
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('sends plan limit message when monthly count exceeded', async () => {
    setupExisting({ ...TENANT, plan: 'basic' });
    monthlyCountResult = { count: 9999 };
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      expect.stringContaining('limite de mensajes')
    );
  });

  it('sends welcome message for new conversations', async () => {
    setupNew(TENANT);
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'hola' } }));
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-123',
      '5219991234567',
      'Bienvenido a Clinica Dental Test!'
    );
  });

  it('classifies intent correctly', async () => {
    setupExisting();
    mockClassifyIntent.mockReturnValue('APPOINTMENT');
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Quiero una cita' } }));
    expect(mockClassifyIntent).toHaveBeenCalledWith('Quiero una cita');
  });

  it('calls RAG search with correct tenant ID', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Cuanto cuesta?' } }));
    expect(mockSearchKnowledge).toHaveBeenCalledWith('tenant-1', 'Cuanto cuesta?');
  });

  it('selects model using routing rules', async () => {
    setupExisting();
    mockClassifyIntent.mockReturnValue('PRICING');
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Precios' } }));
    expect(mockSelectModel).toHaveBeenCalledWith('PRICING', 'dental', 'pro');
  });

  it('validates response with guardrails', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockValidateResponse).toHaveBeenCalledWith(
      'Con gusto le ayudo.',
      expect.objectContaining({ id: 'tenant-1' }),
      expect.any(String),
      expect.any(String)
    );
  });

  it('saves outbound message to DB', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola que tal' } }));
    // insert called for inbound + outbound
    expect(mockInsertMessages).toHaveBeenCalled();
    const calls = mockInsertMessages.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('updates conversation with last_message_at', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola que tal' } }));
    expect(mockUpdateConversations).toHaveBeenCalledWith(
      expect.objectContaining({ last_message_at: expect.any(String) })
    );
  });

  it('handles sticker messages', async () => {
    setupExisting();
    await processIncomingMessage(makeBody({ type: 'sticker' }));
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles interactive button_reply', async () => {
    setupExisting();
    await processIncomingMessage(
      makeBody({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { title: 'Si, agendar' } },
      })
    );
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('handles interactive list_reply', async () => {
    setupExisting();
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
    setupExisting();
    await processIncomingMessage(
      makeBody({ type: 'text', text: { body: '<script>alert("xss")</script>Hola' } })
    );
    expect(mockClassifyIntent).toHaveBeenCalledWith(expect.not.stringContaining('<script>'));
  });
});
