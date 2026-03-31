import { describe, it, expect } from 'vitest';
import { selectModel, calculateCost, MODELS } from '../openrouter';

describe('MODELS constants', () => {
  it('define todos los modelos necesarios', () => {
    expect(MODELS.CLASSIFIER).toBeDefined();
    expect(MODELS.STANDARD).toBeDefined();
    expect(MODELS.BALANCED).toBeDefined();
    expect(MODELS.PREMIUM).toBeDefined();
    expect(MODELS.VOICE).toBeDefined();
    expect(MODELS.GENERATOR).toBeDefined();
  });

  it('STANDARD es Gemini Flash-Lite', () => {
    expect(MODELS.STANDARD).toContain('flash-lite');
  });

  it('PREMIUM es Claude Sonnet', () => {
    expect(MODELS.PREMIUM).toContain('claude');
  });
});

describe('selectModel() — 7 reglas de routing', () => {
  // REGLA 1: Premium plan → siempre BALANCED
  it('plan premium → BALANCED', () => {
    expect(selectModel('GREETING', 'restaurant', 'premium')).toBe(MODELS.BALANCED);
  });

  it('plan premium sobrescribe todo', () => {
    expect(selectModel('FAQ', 'taqueria', 'premium')).toBe(MODELS.BALANCED);
  });

  // REGLA 2: Intents sensibles → PREMIUM (Claude)
  it('EMERGENCY → PREMIUM', () => {
    expect(selectModel('EMERGENCY', 'restaurant', 'basic')).toBe(MODELS.PREMIUM);
  });

  it('COMPLAINT → PREMIUM', () => {
    expect(selectModel('COMPLAINT', 'salon', 'basic')).toBe(MODELS.PREMIUM);
  });

  it('HUMAN → PREMIUM', () => {
    expect(selectModel('HUMAN', 'gym', 'basic')).toBe(MODELS.PREMIUM);
  });

  it('CRISIS → PREMIUM', () => {
    expect(selectModel('CRISIS', 'cafe', 'basic')).toBe(MODELS.PREMIUM);
  });

  it('MEDICAL_QUESTION → PREMIUM', () => {
    expect(selectModel('MEDICAL_QUESTION', 'restaurant', 'basic')).toBe(MODELS.PREMIUM);
  });

  it('LEGAL_QUESTION → PREMIUM', () => {
    expect(selectModel('LEGAL_QUESTION', 'hotel', 'basic')).toBe(MODELS.PREMIUM);
  });

  // REGLA 3: Negocios de salud → BALANCED
  it('dental → BALANCED', () => {
    expect(selectModel('GREETING', 'dental', 'basic')).toBe(MODELS.BALANCED);
  });

  it('medical → BALANCED', () => {
    expect(selectModel('FAQ', 'medical', 'basic')).toBe(MODELS.BALANCED);
  });

  it('psychologist → BALANCED', () => {
    expect(selectModel('GREETING', 'psychologist', 'pro')).toBe(MODELS.BALANCED);
  });

  it('nutritionist → BALANCED', () => {
    expect(selectModel('PRICE', 'nutritionist', 'basic')).toBe(MODELS.BALANCED);
  });

  it('dermatologist → BALANCED', () => {
    expect(selectModel('FAQ', 'dermatologist', 'basic')).toBe(MODELS.BALANCED);
  });

  it('pediatrician → BALANCED', () => {
    expect(selectModel('HOURS', 'pediatrician', 'basic')).toBe(MODELS.BALANCED);
  });

  // REGLA 4: Inmobiliaria + crédito → BALANCED
  it('real_estate + PRICE → BALANCED', () => {
    expect(selectModel('PRICE', 'real_estate', 'basic')).toBe(MODELS.BALANCED);
  });

  it('real_estate + APPOINTMENT_NEW → BALANCED', () => {
    expect(selectModel('APPOINTMENT_NEW', 'real_estate', 'basic')).toBe(MODELS.BALANCED);
  });

  // REGLA 5: Veterinaria emergencia → PREMIUM
  it('veterinary + EMERGENCY → PREMIUM', () => {
    expect(selectModel('EMERGENCY', 'veterinary', 'basic')).toBe(MODELS.PREMIUM);
  });

  // REGLA 6: Agendamiento/pedidos → BALANCED
  it('APPOINTMENT_NEW → BALANCED', () => {
    expect(selectModel('APPOINTMENT_NEW', 'salon', 'basic')).toBe(MODELS.BALANCED);
  });

  it('ORDER_NEW → BALANCED', () => {
    expect(selectModel('ORDER_NEW', 'restaurant', 'basic')).toBe(MODELS.BALANCED);
  });

  // REGLA 7: Default → STANDARD
  it('GREETING + restaurant → STANDARD', () => {
    expect(selectModel('GREETING', 'restaurant', 'basic')).toBe(MODELS.STANDARD);
  });

  it('FAQ + taqueria → STANDARD', () => {
    expect(selectModel('FAQ', 'taqueria', 'basic')).toBe(MODELS.STANDARD);
  });

  it('HOURS + gym → STANDARD', () => {
    expect(selectModel('HOURS', 'gym', 'basic')).toBe(MODELS.STANDARD);
  });

  it('LOCATION + florist → STANDARD', () => {
    expect(selectModel('LOCATION', 'florist', 'basic')).toBe(MODELS.STANDARD);
  });
});

describe('calculateCost()', () => {
  it('calcula costo con tokens conocidos', () => {
    const cost = calculateCost('google/gemini-2.5-flash-lite', 1000, 500);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  it('costo cero con cero tokens', () => {
    expect(calculateCost('google/gemini-2.5-flash-lite', 0, 0)).toBe(0);
  });

  it('modelo desconocido devuelve 0', () => {
    expect(calculateCost('unknown/model', 1000, 500)).toBe(0);
  });

  it('Claude es más caro que Gemini Flash-Lite', () => {
    const claudeCost = calculateCost('anthropic/claude-sonnet-4-6', 1000, 500);
    const geminiCost = calculateCost('google/gemini-2.5-flash-lite', 1000, 500);
    expect(claudeCost).toBeGreaterThan(geminiCost);
  });
});
