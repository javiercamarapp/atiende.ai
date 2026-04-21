import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunChatAgent = vi.fn();
const mockScrapeUrl = vi.fn();

vi.mock('@/lib/onboarding/chat-agent', () => ({
  runChatAgent: (...args: unknown[]) => mockRunChatAgent(...args),
}));

vi.mock('@/lib/onboarding/scrape', async () => {
  const actual = await vi.importActual<typeof import('@/lib/onboarding/scrape')>(
    '@/lib/onboarding/scrape',
  );
  return {
    ...actual,
    scrapeUrl: (...args: unknown[]) => mockScrapeUrl(...args),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-test' } } }),
    },
  }),
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue(false),
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const defaultAgentResult = {
  vertical: 'dental' as const,
  updatedFields: {},
  // AUDIT R15: messages must include `?` o `¿` para evitar el "dead-end
  // recovery" que inyecta la siguiente pregunta pendiente automáticamente
  // (feature legítimo del route). Tests afectados usan un default con
  // question mark para simular un turno bien formado del LLM.
  assistantMessages: ['ok, ¿en qué más le puedo ayudar?'],
  done: false,
  clarificationOf: null,
  cost: 0.0001,
  model: 'qwen/qwen3-235b-a22b-2507',
  tokensIn: 500,
  tokensOut: 50,
};

describe('POST /api/onboarding/chat', () => {
  beforeEach(() => {
    mockRunChatAgent.mockReset();
    mockScrapeUrl.mockReset();
  });

  it('rejects invalid body with 400', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid input');
  });

  it('rejects empty userMessage', async () => {
    const res = await POST(
      makeRequest({ vertical: null, capturedFields: {}, history: [], userMessage: '' }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts minimal valid body and returns agent response', async () => {
    mockRunChatAgent.mockResolvedValueOnce(defaultAgentResult);
    // Pass vertical=dental so this isn't a detection turn; the insight
    // injection path is covered by its own dedicated test below.
    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'un mensaje cualquiera',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.vertical).toBe('dental');
    expect(json.assistantMessages).toEqual(['ok, ¿en qué más le puedo ayudar?']);
    expect(json.done).toBe(false);
  });

  it('calls scrapeUrl when userMessage contains a URL', async () => {
    mockScrapeUrl.mockResolvedValueOnce({
      url: 'https://clinica.com/',
      markdown: '# Clínica\n\nHorario L-V 9-19',
      truncated: false,
    });
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      updatedFields: { q1: 'Clínica Test' },
    });

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'mi sitio es https://clinica.com gracias',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockScrapeUrl).toHaveBeenCalledWith('https://clinica.com');
    // Agent should have been called with scrapedMarkdown
    const agentCall = mockRunChatAgent.mock.calls[0][0];
    expect(agentCall.scrapedMarkdown).toContain('Clínica');
    const json = await res.json();
    expect(json.scrape.succeeded).toBe(true);
  });

  it('passes scrapeError to agent when scrape fails', async () => {
    const { ScrapeError } = await import('@/lib/onboarding/scrape');
    mockScrapeUrl.mockRejectedValueOnce(
      new ScrapeError('TIMEOUT', 'Scrape timed out after 8000ms'),
    );
    mockRunChatAgent.mockResolvedValueOnce(defaultAgentResult);

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'https://down.com',
      }),
    );
    expect(res.status).toBe(200);
    const agentCall = mockRunChatAgent.mock.calls[0][0];
    expect(agentCall.scrapeError).toBeDefined();
    const json = await res.json();
    expect(json.scrape.succeeded).toBe(false);
    expect(json.scrape.error).toContain('TIMEOUT');
  });

  it('does NOT trust model done:true if required fields missing', async () => {
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      done: true,
      updatedFields: { q1: 'Clínica X' },
    });

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'Clínica X',
      }),
    );
    const json = await res.json();
    // Dental has ~15 required fields, one q1 isn't enough
    expect(json.done).toBe(false);
  });

  it('merges capturedFields with updatedFields in response', async () => {
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      updatedFields: { q2: 'Calle Nueva' },
    });

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: { q1: 'Clínica ABC' },
        history: [],
        userMessage: 'Calle Nueva 123',
      }),
    );
    const json = await res.json();
    expect(json.capturedFields).toEqual({
      q1: 'Clínica ABC',
      q2: 'Calle Nueva',
    });
  });

  it('returns 500 with fallback message on agent failure', async () => {
    const { StructuredGenerationError } = await import('@/lib/llm/openrouter');
    mockRunChatAgent.mockRejectedValueOnce(
      new StructuredGenerationError('parse failed'),
    );

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'algo',
      }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('agent_failed');
    expect(json.assistantMessages[0]).toMatch(/trabó/);
  });

  it('forwards uploadedContent to the agent', async () => {
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      updatedFields: { q8: 'Limpieza $500' },
    });

    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'aquí va mi lista de precios',
        uploadedContent: [
          {
            filename: 'precios.jpg',
            markdown: '# Precios\n- Limpieza: $500',
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const agentCall = mockRunChatAgent.mock.calls[0][0];
    expect(agentCall.uploadedContent).toHaveLength(1);
    expect(agentCall.uploadedContent[0].filename).toBe('precios.jpg');
    expect(agentCall.uploadedContent[0].markdown).toContain('Limpieza');
  });

  it('rejects bodies with malformed uploadedContent entries', async () => {
    const res = await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history: [],
        userMessage: 'x',
        uploadedContent: [
          { filename: '', markdown: 'x' }, // empty filename
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('prepends the vertical insight when vertical is newly detected', async () => {
    // incoming vertical is null, agent returns vertical='dental' → insight should be injected
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      vertical: 'dental',
      assistantMessages: ['¡Qué bien! ¿Cómo se llama tu consultorio?'],
    });

    const res = await POST(
      makeRequest({
        vertical: null,
        capturedFields: {},
        history: [],
        userMessage: 'soy dentista en Mérida',
      }),
    );
    const json = await res.json();
    expect(json.verticalJustDetected).toBe(true);
    expect(json.assistantMessages).toHaveLength(2);
    // First message is the insight (contains a stat / value prop)
    expect(json.assistantMessages[0]).toContain('dentales');
    // Second message is the agent's own follow-up
    expect(json.assistantMessages[1]).toContain('consultorio');
  });

  it('does NOT prepend insight when vertical was already set', async () => {
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      vertical: 'dental',
      assistantMessages: ['¿Me confirmas tu horario?'],
    });

    const res = await POST(
      makeRequest({
        vertical: 'dental', // already known, not a detection turn
        capturedFields: { q1: 'Clínica X' },
        history: [],
        userMessage: 'L-V 9-19',
      }),
    );
    const json = await res.json();
    expect(json.verticalJustDetected).toBe(false);
    expect(json.assistantMessages).toHaveLength(1);
    expect(json.assistantMessages[0]).toContain('horario');
  });

  it('caps injected insight + agent messages at 3 total', async () => {
    mockRunChatAgent.mockResolvedValueOnce({
      ...defaultAgentResult,
      vertical: 'dental',
      assistantMessages: [
        'mensaje 1 del agente',
        // AUDIT R15: msg2 debe incluir `?` porque tras slice(0,3) se vuelve
        // el último visible (msg3 se descarta) y sin `?` dispararía el
        // "dead-end recovery" del route que inyecta una pregunta extra.
        'mensaje 2 del agente ¿ok?',
        'mensaje 3 del agente', // would overflow with insight prepended
      ],
    });

    const res = await POST(
      makeRequest({
        vertical: null,
        capturedFields: {},
        history: [],
        userMessage: 'soy dentista',
      }),
    );
    const json = await res.json();
    expect(json.assistantMessages).toHaveLength(3); // insight + 2 agent msgs (3rd truncated)
    // Insight is first, then first 2 agent msgs
    expect(json.assistantMessages[0]).toContain('dentales');
    expect(json.assistantMessages[1]).toBe('mensaje 1 del agente');
    expect(json.assistantMessages[2]).toBe('mensaje 2 del agente ¿ok?');
  });

  it('passes incoming history into agent', async () => {
    mockRunChatAgent.mockResolvedValueOnce(defaultAgentResult);
    const history = [
      { role: 'user' as const, content: 'hola' },
      { role: 'assistant' as const, content: 'hola! cuentame' },
    ];
    await POST(
      makeRequest({
        vertical: 'dental',
        capturedFields: {},
        history,
        userMessage: 'siguiente',
      }),
    );
    const agentCall = mockRunChatAgent.mock.calls[0][0];
    expect(agentCall.history).toEqual(history);
  });
});
