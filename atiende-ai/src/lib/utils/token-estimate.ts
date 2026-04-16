// ═════════════════════════════════════════════════════════════════════════════
// TOKEN ESTIMATE — aproximación conservadora de conteo de tokens sin deps
//
// AUDIT R18 BUG-007: antes truncábamos el history por `content.length` (chars)
// asumiendo ratio 1:1 con tokens. Eso es frágil para:
//   - Emojis: 1-3 tokens cada uno según el tokenizador.
//   - Acentos/ñ en español: a veces 2 tokens por carácter compuesto.
//   - JSON con comillas/backslashes: ratio char/token cae bajo 2.
//
// Solución sin dependencias: estimación conservadora 3 chars/token. Para
// Spanish+emojis medio real, el ratio es ~3.5-4 chars/token; 3 nos da un
// safety buffer del 15-25% que previene overflow del context window sin
// gastar una dep pesada como tiktoken (800KB+ en el bundle).
//
// Si en el futuro necesitamos precisión real, cambiar esta función a usar
// `@dqbd/tiktoken` (WASM lite) o llamar la API de tokens de OpenAI.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Conservative chars-to-tokens ratio for Spanish + mixed content.
 * Lower = more conservative (reports MORE tokens for given chars).
 */
const CHARS_PER_TOKEN = 3;

/**
 * Estimate token count for a string. Conservative: returns a slight over-estimate
 * so that budget calculations are safe against worst-case tokenization.
 *
 * @example
 *   estimateTokens('hola') → 2  (4 chars / 3 ≈ 1.33 → ceil = 2)
 *   estimateTokens('') → 0
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for an array of messages (sums content length).
 */
export function estimateTokensForMessages(
  messages: ReadonlyArray<{ content: string | null | undefined }>,
): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
  }
  return total;
}
