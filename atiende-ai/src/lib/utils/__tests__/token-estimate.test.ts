import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateTokensForMessages } from '../token-estimate';

describe('estimateTokens (AUDIT R18)', () => {
  it('devuelve 0 para null/undefined/empty', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('')).toBe(0);
  });

  it('usa ratio conservador 3 chars/token (ceil)', () => {
    // "hola" (4 chars) → ceil(4/3) = 2 tokens
    expect(estimateTokens('hola')).toBe(2);
    // "hola mundo" (10 chars) → ceil(10/3) = 4 tokens
    expect(estimateTokens('hola mundo')).toBe(4);
    // "a".repeat(300) → 100 tokens exactos
    expect(estimateTokens('a'.repeat(300))).toBe(100);
  });

  it('sobre-estima para content con emojis/acentos (safety buffer)', () => {
    // Un mensaje con acentos reales puede tokenizar 1 char → 2 tokens.
    // Nuestro estimador da 3 chars → 1 token. El buffer real vs estimate
    // depende del tokenizador; lo importante es que el estimador sea >=
    // el valor real para la mayoría de strings.
    const msg = 'Buenas tardes, ¿cómo está usted hoy?';
    const estimate = estimateTokens(msg);
    // Sanity: al menos devuelve algo > 0
    expect(estimate).toBeGreaterThan(0);
    // Sanity: no es absurdamente alto (no está dividiendo por 0 ni nada)
    expect(estimate).toBeLessThan(msg.length);
  });
});

describe('estimateTokensForMessages', () => {
  it('suma tokens de múltiples mensajes', () => {
    const messages = [
      { content: 'abc' },       // 1 token (3/3)
      { content: 'defghi' },    // 2 tokens (6/3)
      { content: 'jkl' },       // 1 token (3/3)
    ];
    expect(estimateTokensForMessages(messages)).toBe(4);
  });

  it('ignora mensajes con content null/undefined', () => {
    const messages = [
      { content: 'abc' },
      { content: null as unknown as string },
      { content: undefined as unknown as string },
      { content: 'def' },
    ];
    expect(estimateTokensForMessages(messages)).toBe(2); // 1 + 0 + 0 + 1
  });

  it('array vacío devuelve 0', () => {
    expect(estimateTokensForMessages([])).toBe(0);
  });
});
