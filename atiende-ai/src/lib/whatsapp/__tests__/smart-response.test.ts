import { describe, it, expect } from 'vitest';
import { splitMessage, detectLanguage } from '../smart-response';

describe('splitMessage — empty input handling', () => {
  it('returns empty array for empty string', () => {
    expect(splitMessage('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(splitMessage('   \n  \t ')).toEqual([]);
  });

  it('returns empty array for null-coerced input', () => {
    expect(splitMessage(undefined as unknown as string)).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    expect(splitMessage('Hola mundo')).toEqual(['Hola mundo']);
  });

  it('trims input before returning single chunk', () => {
    expect(splitMessage('  Hola mundo  ')).toEqual(['Hola mundo']);
  });

  it('splits long text into multiple chunks', () => {
    // 3000 chars > PREFERRED_SPLIT_LENGTH (1500) → should split
    const sentence = 'Esta es una oración de prueba. ';
    const longText = sentence.repeat(120); // ~3600 chars
    const chunks = splitMessage(longText);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => {
      expect(c.length).toBeLessThanOrEqual(1500);
      expect(c.trim().length).toBeGreaterThan(0);
    });
  });

  it('preserves full content across chunks (no lost characters)', () => {
    const original = 'Frase uno. Frase dos. '.repeat(100);
    const chunks = splitMessage(original);
    const recombined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    const expected = original.replace(/\s+/g, ' ').trim();
    expect(recombined).toBe(expected);
  });
});

describe('detectLanguage', () => {
  it('defaults to Spanish for empty input', () => {
    expect(detectLanguage('')).toBe('es');
  });

  it('defaults to Spanish for ambiguous input', () => {
    expect(detectLanguage('xyz abc 123')).toBe('es');
  });

  it('detects Spanish greeting', () => {
    expect(detectLanguage('hola buenos días, quiero agendar')).toBe('es');
  });

  it('detects English when markers clearly dominate', () => {
    expect(detectLanguage('hello, i want to book an appointment please, how much is the price')).toBe('en');
  });
});
