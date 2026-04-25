/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────

// Use vi.hoisted so mock fns are available in hoisted vi.mock factories
const {
  mockGenerateResponse,
  mockSelectModel,
  mockClassifyIntent,
  mockSearchKnowledge,
  mockValidateResponse,
  mockSendTextMessage,
  mockMarkAsRead,
  mockSendTypingIndicator,
  mockTranscribeAudio,
  mockCheckRateLimit,
  mockCheckTenantLimit,
  mockInsertMessages,
  mockInsertContacts,
  mockInsertConversations,
  mockUpdateConversations,
} = vi.hoisted(() => ({
  mockGenerateResponse: vi.fn(() => ({
    text: 'Con gusto le ayudo.',
    model: 'test-model',
    tokensIn: 10,
    tokensOut: 20,
    cost: 0.001,
  })),
  mockSelectModel: vi.fn(() => 'test-model'),
  mockClassifyIntent: vi.fn(() => 'GREETING'),
  mockSearchKnowledge: vi.fn(() => ''),
  mockValidateResponse: vi.fn(
    (text: string) => ({ valid: true, text })
  ),
  mockSendTextMessage: vi.fn(),
  mockMarkAsRead: vi.fn(() => Promise.resolve()),
  mockSendTypingIndicator: vi.fn(() => Promise.resolve()),
  mockTranscribeAudio: vi.fn((_id?: string) => 'transcribed text'),
  mockCheckRateLimit: vi.fn(() => ({ allowed: true })),
  mockCheckTenantLimit: vi.fn(() => ({ allowed: true })),
  mockInsertMessages: vi.fn(() => ({
    select: vi.fn(() => ({ single: vi.fn(() => ({ data: null })) })),
  })),
  mockInsertContacts: vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(() => ({ data: { id: 'contact-1', name: null } })),
    })),
  })),
  mockInsertConversations: vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(() => ({ data: { id: 'conv-1', status: 'active', customer_name: null } })),
    })),
  })),
  mockUpdateConversations: vi.fn(() => ({ eq: vi.fn() })),
}));

// Track per-table mock behavior
let tenantResult: any = { data: null };
let contactResult: any = { data: null };
let conversationResult: any = { data: null };
let monthlyCountResult: any = { count: 0 };
let messagesHistory: any = { data: [] };

function makeChainable(terminalValue: () => any) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockImplementation(() => terminalValue());
  chain.order = vi.fn().mockReturnValue({ limit: vi.fn().mockImplementation(() => messagesHistory) });
  chain.limit = vi.fn().mockReturnValue({ data: [] });
  chain.single = vi.fn().mockImplementation(() => terminalValue());
  // Added for the wa_message_id idempotency check in handleSingleMessage —
  // the dedup query ends with .maybeSingle(). Returning { data: null }
  // means "not seen before" so the test flow proceeds as before.
  chain.maybeSingle = vi.fn().mockReturnValue({ data: null });
  chain.insert = vi.fn().mockReturnValue({
    select: vi.fn(() => ({ single: vi.fn(() => ({ data: null })) })),
  });
  chain.update = vi.fn().mockReturnValue({ eq: vi.fn() });
  return chain;
}

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
        // El lookup de conversación en inbound-upsert.ts ahora usa
        // .maybeSingle() (antes .single() — generaba 400 ruidosos en logs).
        // Override del default { data: null } para que devuelva la fixture
        // del test cuando hay conversationResult seteado.
        chain.maybeSingle = vi.fn().mockImplementation(() => conversationResult);
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
    // AUDIT R14 BUG-001: atomicInboundUpsert llama supabaseAdmin.rpc(
    // 'upsert_inbound_message', ...). En tests hacemos que retorne error
    // PGRST202 → el helper cae al legacy path (secuencial via .from()) y
    // los tests existentes siguen funcionando.
    rpc: vi.fn(() => Promise.resolve({
      data: null,
      error: { code: 'PGRST202', message: 'function does not exist (test mock)' },
    })),
  },
}));

vi.mock('@/lib/llm/openrouter', () => ({
  generateResponse: mockGenerateResponse,
  selectModel: mockSelectModel,
  // MODELS const referenced transitively via @/lib/agents/registry
  // (Phase 2.D wired processor.handleWithOrchestrator to the new agent
  // structure). The mock ONLY needs the keys the registry reads at module
  // load time — no behavior change to the existing test assertions.
  MODELS: {
    CLASSIFIER: 'mock/classifier',
    STANDARD: 'mock/standard',
    BALANCED: 'mock/balanced',
    PREMIUM: 'mock/premium',
    VOICE: 'mock/voice',
    GENERATOR: 'mock/generator',
    ONBOARDING_AGENT: 'mock/onboarding',
    ONBOARDING_AGENT_FALLBACK: 'mock/onboarding-fallback',
    ORCHESTRATOR: 'mock/orchestrator',
    ORCHESTRATOR_FALLBACK: 'mock/orchestrator-fallback',
  },
  // Other helpers from openrouter that may be transitively required
  generateStructured: vi.fn(),
  generateWithTools: vi.fn(),
  calculateCost: vi.fn(() => 0),
  getOpenRouter: vi.fn(),
  StructuredGenerationError: class extends Error {},
  LoopGuardError: class extends Error {},
}));

vi.mock('@/lib/llm/classifier', () => ({
  classifyIntent: mockClassifyIntent,
}));

vi.mock('@/lib/rag/search', () => ({
  searchKnowledge: mockSearchKnowledge,
}));

vi.mock('@/lib/guardrails/validate', () => ({
  validateResponse: mockValidateResponse,
  appendMedicalDisclaimer: (_userMsg: string, agentResponse: string) => agentResponse,
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: mockSendTextMessage,
  sendTextMessageSafe: mockSendTextMessage,
  markAsRead: mockMarkAsRead,
  sendTypingIndicator: mockSendTypingIndicator,
  sendButtonMessage: vi.fn(() => Promise.resolve({ ok: true })),
  sendListMessage: vi.fn(() => Promise.resolve({ ok: true })),
  sendTemplate: vi.fn(() => Promise.resolve({ ok: true })),
  sendLocation: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('@/lib/voice/deepgram', () => ({
  transcribeAudio: mockTranscribeAudio,
}));

// AUDIT R15 TEST FIX: el nuevo pipeline usa `import * as mediaProcessor
// from '@/lib/whatsapp/media-processor'` (namespace import). El mock debe
// exportar las funciones a nivel de módulo, no anidadas dentro de un objeto.
vi.mock('@/lib/whatsapp/media-processor', () => ({
  transcribeAudio: vi.fn(async (id: string) => {
    mockTranscribeAudio(id);
    return { ok: true, text: 'transcribed text' };
  }),
  describeImage: vi.fn(async (_id: string, _tid: string, caption?: string) => ({
    ok: true,
    text: caption ? `desc: ${caption}` : 'desc: placeholder',
  })),
  extractPdfText: vi.fn(async () => ({ ok: true, text: 'doc text' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  checkTenantLimit: mockCheckTenantLimit,
  checkTenantRateLimit: mockCheckTenantLimit,
}));

// AUDIT R14 BUG-002: el gate mensual ahora usa reserveMonthlyMessage (INCR
// atómico en Redis). En tests sin Redis, simulamos el contador con la misma
// variable `monthlyCountResult` que antes usaba el path DB-count, para
// preservar el comportamiento de los tests existentes.
vi.mock('@/lib/rate-limit-monthly', () => ({
  reserveMonthlyMessage: vi.fn((_tenantId: string, planLimit: number) => {
    const count = (monthlyCountResult as { count?: number })?.count ?? 0;
    const next = count + 1;
    if (next > planLimit) {
      return Promise.resolve({ allowed: false, count, usingRedis: true });
    }
    return Promise.resolve({ allowed: true, count: next, usingRedis: true });
  }),
  releaseMonthlyReservation: vi.fn(() => Promise.resolve()),
  getMonthlyMessageCount: vi.fn(() => Promise.resolve(0)),
  incrementMonthlyMessages: vi.fn(() => Promise.resolve(1)),
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
    // AUDIT R15: smart-response route al canal adecuado según intent.
    // GREETING ahora usa sendButtonMessage (quick replies). El test verifica
    // que la pipeline corrió hasta emitir respuesta (el mock del send.ts
    // exporta button+text+list; cualquiera se considera una salida válida).
    expect(mockInsertMessages).toHaveBeenCalled(); // outbound persistido
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

  it('does NOT enforce monthly cap when plan limit is unlimited (v4)', async () => {
    // v4 (PLAN_MSG_LIMITS_MONTHLY = Infinity para todos los planes): el gate
    // salta el reserveMonthlyMessage cuando el cap es Infinity, así que el
    // mensaje "limite de mensajes" NUNCA se envía. Si un tenant real llega
    // acá significa que el producto volvió a tener caps finitos y hay que
    // actualizar el test para reflejar ese comportamiento nuevo.
    setupExisting({ ...TENANT, plan: 'basic' });
    monthlyCountResult = { count: 9999 }; // simulado — no debe importar
    await processIncomingMessage(makeBody({ type: 'text', text: { body: 'Hola' } }));
    expect(mockSendTextMessage).not.toHaveBeenCalledWith(
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
    // AUDIT R15: validateResponse signature (bot_text, tenant_shape, rag, user, intent).
    // El tenant_shape ahora es {business_type, name} (suficiente para el
    // guardrail, sin pasar objeto completo). Intent fue agregado para
    // permitir fallbacks contextuales y skip de price-validation.
    expect(mockValidateResponse).toHaveBeenCalledWith(
      'Con gusto le ayudo.',
      expect.objectContaining({ business_type: 'dental' }),
      expect.any(String),
      expect.any(String),
      expect.any(String),
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
