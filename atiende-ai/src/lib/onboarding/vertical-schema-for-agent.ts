// Compact vertical-schema serialization for the conversational onboarding agent.
// Turns the structured `VerticalQuestion[]` schema into a token-efficient block
// that the LLM can reason over ("which field is still missing?") without
// blowing up context.

import type { VerticalEnum, VerticalQuestion } from '@/lib/verticals/types';
import { getVerticalQuestions, VERTICAL_NAMES } from '@/lib/verticals';

export interface FieldsBlockOptions {
  /**
   * Maximum characters to include per `[YA CAPTURADO: "..."]` snippet before
   * truncating with ellipsis. Keeps the schema block bounded.
   */
  maxCapturedPreview?: number;
}

/**
 * Build the compact "fields to capture" block shown to the agent in the system
 * prompt. One line per question, with:
 *   [REQ] qN — text
 *          por qué: why
 *          [YA CAPTURADO: "valor"]   ← only if captured
 */
export function buildFieldsBlock(
  vertical: VerticalEnum,
  captured: Record<string, string>,
  options: FieldsBlockOptions = {},
): string {
  const questions = getVerticalQuestions(vertical);
  if (questions.length === 0) return '(no hay schema de preguntas para este vertical)';

  const maxPreview = options.maxCapturedPreview ?? 80;
  const lines: string[] = [];

  for (const q of questions) {
    const reqTag = q.required ? '[REQ]' : '[   ]';
    const key = `q${q.number}`;
    lines.push(`${reqTag} ${key} — ${q.text}`);
    lines.push(`       por qué: ${q.why}`);
    const existing = captured[key];
    if (existing && existing.trim().length > 0) {
      const preview =
        existing.length > maxPreview
          ? existing.slice(0, maxPreview) + '…'
          : existing;
      lines.push(`       [YA CAPTURADO: "${preview}"]`);
    }
  }

  return lines.join('\n');
}

/** Count of required fields for a vertical. */
export function countRequired(vertical: VerticalEnum): number {
  return getVerticalQuestions(vertical).filter((q) => q.required).length;
}

/** Count of required fields that have non-empty answers in `captured`. */
export function countCapturedRequired(
  vertical: VerticalEnum,
  captured: Record<string, string>,
): number {
  const questions = getVerticalQuestions(vertical);
  let n = 0;
  for (const q of questions) {
    if (!q.required) continue;
    const v = captured[`q${q.number}`];
    if (v && v.trim().length > 0) n++;
  }
  return n;
}

/** True iff every required field in the vertical has a non-empty captured value. */
export function allRequiredFilled(
  vertical: VerticalEnum,
  captured: Record<string, string>,
): boolean {
  const questions = getVerticalQuestions(vertical);
  if (questions.length === 0) return false;
  for (const q of questions) {
    if (!q.required) continue;
    const v = captured[`q${q.number}`];
    if (!v || v.trim().length === 0) return false;
  }
  return true;
}

/** Return the set of valid `qN` keys for the vertical (used to reject spurious fields). */
export function validKeysForVertical(vertical: VerticalEnum): Set<string> {
  const questions: VerticalQuestion[] = getVerticalQuestions(vertical);
  return new Set(questions.map((q) => `q${q.number}`));
}

/** Friendly display name for a vertical. */
export function getVerticalDisplayName(vertical: VerticalEnum): string {
  return VERTICAL_NAMES[vertical] ?? vertical;
}
