import { describe, it, expect } from 'vitest';
import { analyzeSentiment } from '../sentiment';

describe('analyzeSentiment()', () => {
  it('detecta sentimiento positivo', () => {
    const result = analyzeSentiment('Gracias, excelente servicio, me encanta');
    expect(result.label).toBe('positive');
    expect(result.score).toBeGreaterThan(0);
  });

  it('detecta sentimiento negativo', () => {
    const result = analyzeSentiment('Horrible servicio, pésimo, terrible');
    expect(result.label).toBe('negative');
    expect(result.score).toBeLessThan(0);
  });

  it('detecta sentimiento neutral', () => {
    const result = analyzeSentiment('Hola, quiero agendar una cita');
    expect(result.label).toBe('neutral');
    expect(result.score).toBe(0);
  });

  it('detecta urgencia', () => {
    const result = analyzeSentiment('Urgente, necesito cita ya, tengo dolor');
    expect(result.urgent).toBe(true);
  });

  it('no urgente en mensaje normal', () => {
    const result = analyzeSentiment('Buenas tardes, me gustaría agendar');
    expect(result.urgent).toBe(false);
  });

  it('string vacío es neutral', () => {
    const result = analyzeSentiment('');
    expect(result.label).toBe('neutral');
    expect(result.urgent).toBe(false);
  });

  it('mixto positivo+negativo calcula score neto', () => {
    const result = analyzeSentiment('Gracias pero fue malo');
    expect(typeof result.score).toBe('number');
  });

  it('palabras de emergencia detectan urgencia', () => {
    expect(analyzeSentiment('Mi mascota tiene una emergencia').urgent).toBe(true);
    expect(analyzeSentiment('Hay sangre').urgent).toBe(true);
  });

  it('score numérico siempre retornado', () => {
    const result = analyzeSentiment('cualquier texto');
    expect(typeof result.score).toBe('number');
    expect(['positive', 'neutral', 'negative']).toContain(result.label);
  });
});
