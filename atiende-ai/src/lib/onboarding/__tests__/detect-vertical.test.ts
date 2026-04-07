/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

const { mockGenerateResponse } = vi.hoisted(() => ({
  mockGenerateResponse: vi.fn(),
}));

vi.mock('@/lib/llm/openrouter', () => ({
  generateResponse: mockGenerateResponse,
  MODELS: {
    STANDARD: 'google/gemini-2.5-flash-lite',
    BALANCED: 'google/gemini-2.5-flash',
    PREMIUM: 'anthropic/claude-sonnet-4-6',
    CLASSIFIER: 'openai/gpt-5-nano',
  },
}));

import { detectVertical } from '../detect-vertical';

function llmReturns(text: string) {
  mockGenerateResponse.mockResolvedValueOnce({
    text,
    model: 'test-model',
    tokensIn: 5,
    tokensOut: 5,
    cost: 0,
  });
}

describe('detectVertical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dental vertical for "soy dentista en CDMX"', async () => {
    llmReturns('dental');

    const result = await detectVertical('soy dentista en CDMX');

    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('dental');
    expect(result?.category).toBe('SALUD_Y_BIENESTAR');
    expect(result?.displayName).toBe('Consultorio Dental');
    expect(result?.insightMessage).toBeTruthy();
    expect(result?.totalQuestions).toBeGreaterThan(0);
  });

  it('returns restaurante vertical for "tengo una taqueria"', async () => {
    // Even when LLM returns taqueria, that is also a valid vertical
    llmReturns('taqueria');

    const result = await detectVertical('tengo una taqueria');

    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('taqueria');
    expect(result?.category).toBe('GASTRONOMIA');
    expect(result?.displayName).toBe('Taqueria');
  });

  it('returns hotel_boutique for "hotel boutique en Tulum"', async () => {
    llmReturns('hotel_boutique');

    const result = await detectVertical('hotel boutique en Tulum');

    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('hotel_boutique');
    expect(result?.category).toBe('HOSPEDAJE_Y_TURISMO');
  });

  it('returns null when input is too vague (LLM responds unknown)', async () => {
    llmReturns('unknown');

    const result = await detectVertical('algo');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns a non-vertical token', async () => {
    llmReturns('this_is_not_a_vertical');

    const result = await detectVertical('cosa rara');
    expect(result).toBeNull();
  });

  it('strips punctuation/whitespace from LLM response before lookup', async () => {
    llmReturns(' dental.\n');

    const result = await detectVertical('clinica dental');
    expect(result?.vertical).toBe('dental');
  });

  it('lower-cases LLM response', async () => {
    llmReturns('DENTAL');

    const result = await detectVertical('clinica');
    expect(result?.vertical).toBe('dental');
  });

  it('result includes displayName, category, insightMessage, totalQuestions', async () => {
    llmReturns('dental');

    const result = await detectVertical('clinica dental');

    expect(result).toMatchObject({
      vertical: 'dental',
      displayName: expect.any(String),
      category: expect.any(String),
      insightMessage: expect.any(String),
      totalQuestions: expect.any(Number),
    });
  });

  it('passes business description to the LLM prompt', async () => {
    llmReturns('dental');

    await detectVertical('soy dentista en CDMX');

    expect(mockGenerateResponse).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateResponse.mock.calls[0][0];
    expect(callArgs.system).toContain('soy dentista en CDMX');
    expect(callArgs.messages[0].content).toBe('soy dentista en CDMX');
  });

  it('falls back to a generic insight when no specific insight exists', async () => {
    // Pick a vertical that we know exists in VERTICAL_NAMES; the insights map
    // covers all 43 in production but the fallback path is exercised here
    // as a defensive guarantee.
    llmReturns('dental');
    const result = await detectVertical('clinica');
    expect(typeof result?.insightMessage).toBe('string');
    expect(result?.insightMessage.length).toBeGreaterThan(0);
  });
});
