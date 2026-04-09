import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock generateStructured from openrouter BEFORE importing chat-agent
const mockGenerateStructured = vi.fn();

vi.mock('@/lib/llm/openrouter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm/openrouter')>(
    '@/lib/llm/openrouter',
  );
  return {
    ...actual,
    generateStructured: (...args: unknown[]) => mockGenerateStructured(...args),
  };
});

import { runChatAgent, buildAgentSystemPrompt, detectVerticalFromContext } from '../chat-agent';

function mockAgentResult(data: {
  vertical: string | null;
  updatedFields: Record<string, string>;
  assistantMessage: string;
  done?: boolean;
  clarificationOf?: string | null;
}) {
  return {
    data: {
      vertical: data.vertical,
      updatedFields: data.updatedFields,
      assistantMessage: data.assistantMessage,
      done: data.done ?? false,
      clarificationOf: data.clarificationOf ?? null,
    },
    raw: JSON.stringify(data),
    model: 'qwen/qwen3-235b-a22b-2507',
    tokensIn: 500,
    tokensOut: 50,
    cost: 0.0001,
  };
}

describe('buildAgentSystemPrompt', () => {
  it('includes vertical display name when vertical is set', () => {
    const prompt = buildAgentSystemPrompt('dental', {});
    expect(prompt).toContain('dental (Consultorio Dental)');
    expect(prompt).toContain('[REQ] q1 — Nombre completo del consultorio');
  });

  it('shows placeholder when vertical is null', () => {
    const prompt = buildAgentSystemPrompt(null, {});
    expect(prompt).toContain('todavía no identificado');
  });

  it('includes captured values in the block', () => {
    const prompt = buildAgentSystemPrompt('dental', { q1: 'Clínica Sonrisas' });
    expect(prompt).toContain('[YA CAPTURADO: "Clínica Sonrisas"]');
  });

  it('lists all valid verticals in the enum hint', () => {
    const prompt = buildAgentSystemPrompt(null, {});
    expect(prompt).toContain('dental');
    expect(prompt).toContain('restaurante');
    expect(prompt).toContain('hotel');
  });
});

describe('runChatAgent', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
  });

  it('infers vertical on first turn when none provided', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {},
        assistantMessage: '¡Qué bien! Cuéntame, ¿cómo se llama tu consultorio?',
      }),
    );

    const result = await runChatAgent({
      vertical: null,
      capturedFields: {},
      history: [],
      userMessage: 'soy dentista en Mérida',
    });

    expect(result.vertical).toBe('dental');
    expect(result.assistantMessage).toContain('consultorio');
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
  });

  it('keeps vertical if model returns null but input had one', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: null,
        updatedFields: { q1: 'Clínica Sol' },
        assistantMessage: 'Perfecto, ¿dónde están ubicados?',
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'Clínica Sol',
    });

    expect(result.vertical).toBe('dental');
    expect(result.updatedFields.q1).toBe('Clínica Sol');
  });

  it('filters out spurious field keys not in the vertical schema', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {
          q1: 'Clínica Valid',
          q999: 'should be dropped',
          fake_key: 'nope',
        },
        assistantMessage: 'Siguiente pregunta...',
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'Clínica Valid',
    });

    expect(result.updatedFields.q1).toBe('Clínica Valid');
    expect(result.updatedFields.q999).toBeUndefined();
    expect(result.updatedFields.fake_key).toBeUndefined();
  });

  it('trims whitespace and drops empty values from updatedFields', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: { q1: '  Clínica ABC  ', q2: '   ', q3: '' },
        assistantMessage: '...',
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'x',
    });

    expect(result.updatedFields.q1).toBe('Clínica ABC');
    expect(result.updatedFields.q2).toBeUndefined();
    expect(result.updatedFields.q3).toBeUndefined();
  });

  it('handles clarification turn — no fields filled, clarificationOf set', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {},
        assistantMessage: '¿Me podrías ser más específico con el horario?',
        clarificationOf: 'q3',
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: { q1: 'x', q2: 'y' },
      history: [
        { role: 'user', content: 'previo' },
        { role: 'assistant', content: 'cuál es tu horario?' },
      ],
      userMessage: 'no sé',
    });

    expect(result.clarificationOf).toBe('q3');
    expect(Object.keys(result.updatedFields)).toHaveLength(0);
  });

  it('returns done:true when model signals completion', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: { q28: 'Desde los 3 años' },
        assistantMessage: 'Listo, con esto armo tu agente.',
        done: true,
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'Desde los 3 años',
    });

    expect(result.done).toBe(true);
  });

  it('passes scraped markdown into the final user turn', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: { q1: 'Clínica Sonrisas', q2: 'Calle 10 #123' },
        assistantMessage: 'Vi en tu sitio que están en Calle 10. ¿Cuál es el horario?',
      }),
    );

    const result = await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'https://clinica.com',
      scrapedMarkdown: '# Clínica Sonrisas\n\nDirección: Calle 10 #123\n',
    });

    const call = mockGenerateStructured.mock.calls[0][0];
    const finalUserMsg = call.messages[call.messages.length - 1];
    expect(finalUserMsg.role).toBe('user');
    expect(finalUserMsg.content).toContain('CONTENIDO DEL SITIO WEB');
    expect(finalUserMsg.content).toContain('Clínica Sonrisas');
    expect(result.updatedFields.q1).toBe('Clínica Sonrisas');
  });

  it('passes scrape error note when scrape failed', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {},
        assistantMessage: 'No pude abrir tu sitio, ¿puedes contarme los datos a mano?',
      }),
    );

    await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'https://down.com',
      scrapeError: 'Scrape timed out after 8000ms',
    });

    const call = mockGenerateStructured.mock.calls[0][0];
    const finalUserMsg = call.messages[call.messages.length - 1];
    expect(finalUserMsg.content).toContain('falló');
    expect(finalUserMsg.content).toContain('timed out');
  });

  it('injects uploadedContent blocks into the final user turn', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: { q8: 'Limpieza $500, Resina $800' },
        assistantMessage: 'Vi tu lista de precios, ¡gracias!',
      }),
    );

    await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'aquí va mi menú',
      uploadedContent: [
        {
          filename: 'precios.jpg',
          markdown: '# Lista de precios\n- Limpieza: $500\n- Resina: $800',
        },
      ],
    });

    const call = mockGenerateStructured.mock.calls[0][0];
    const finalUserMsg = call.messages[call.messages.length - 1];
    expect(finalUserMsg.content).toContain('ARCHIVO SUBIDO POR EL USUARIO');
    expect(finalUserMsg.content).toContain('precios.jpg');
    expect(finalUserMsg.content).toContain('Limpieza: $500');
  });

  it('injects multiple uploadedContent items when user sends several files', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {},
        assistantMessage: 'ok',
      }),
    );

    await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: [],
      userMessage: 'te mando dos cosas',
      uploadedContent: [
        { filename: 'a.png', markdown: 'AAA' },
        { filename: 'b.png', markdown: 'BBB' },
      ],
    });

    const call = mockGenerateStructured.mock.calls[0][0];
    const finalUserMsg = call.messages[call.messages.length - 1];
    expect(finalUserMsg.content).toContain('a.png');
    expect(finalUserMsg.content).toContain('AAA');
    expect(finalUserMsg.content).toContain('b.png');
    expect(finalUserMsg.content).toContain('BBB');
  });

  it('caps history to last 20 turns', async () => {
    mockGenerateStructured.mockResolvedValueOnce(
      mockAgentResult({
        vertical: 'dental',
        updatedFields: {},
        assistantMessage: 'ok',
      }),
    );

    const longHistory = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg ${i}`,
    }));

    await runChatAgent({
      vertical: 'dental',
      capturedFields: {},
      history: longHistory,
      userMessage: 'current',
    });

    const call = mockGenerateStructured.mock.calls[0][0];
    // 20 history turns + 1 new user turn = 21
    expect(call.messages.length).toBe(21);
  });
});

describe('detectVerticalFromContext', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
  });

  it('returns vertical + confidence from the model', async () => {
    mockGenerateStructured.mockResolvedValueOnce({
      data: { vertical: 'dental', confidence: 0.95 },
      raw: '{}',
      model: 'x',
      tokensIn: 100,
      tokensOut: 20,
      cost: 0.00001,
    });

    const result = await detectVerticalFromContext('soy dentista en Mérida');
    expect(result.vertical).toBe('dental');
    expect(result.confidence).toBe(0.95);
  });

  it('returns null vertical when model is unsure', async () => {
    mockGenerateStructured.mockResolvedValueOnce({
      data: { vertical: null, confidence: 0.3 },
      raw: '{}',
      model: 'x',
      tokensIn: 100,
      tokensOut: 20,
      cost: 0.00001,
    });

    const result = await detectVerticalFromContext('tengo un negocio');
    expect(result.vertical).toBeNull();
  });
});
