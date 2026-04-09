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
  assistantMessage: 'ok',
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
    const res = await POST(
      makeRequest({
        vertical: null,
        capturedFields: {},
        history: [],
        userMessage: 'soy dentista en Mérida',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.vertical).toBe('dental');
    expect(json.assistantMessage).toBe('ok');
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
    expect(json.assistantMessage).toMatch(/trabó/);
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
