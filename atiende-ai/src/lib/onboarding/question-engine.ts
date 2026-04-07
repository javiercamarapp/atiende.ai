// Question Engine — asks questions one-by-one conversationally.
// Questions are delivered as if a real person were asking them: natural
// connectors ("Genial.", "Perfecto.", "Ahora cuentame...") instead of
// "Pregunta 3/17:" meta text. The progress bar in the UI shows the count.

import { getVerticalQuestions } from '@/lib/verticals';
import type { VerticalEnum, VerticalQuestion } from '@/lib/verticals/types';

export interface FormattedQuestion {
  questionNumber: number;
  totalQuestions: number;
  text: string;
  why: string;
  inputType: VerticalQuestion['inputType'];
  required: boolean;
  followUpInsight?: string;
  isLastQuestion: boolean;
  acceptsUpload: boolean;
}

// Conversational connectors alternated to avoid repetition.
// Q1 is always the business-name question — no connector.
const CONNECTORS = [
  'Perfecto.',
  'Genial.',
  'Listo.',
  'Excelente.',
  'Ok.',
  'Anotado.',
  'Entendido.',
];

// Input types that benefit from a file-upload shortcut (PDF or image).
const UPLOAD_INPUT_TYPES = new Set<VerticalQuestion['inputType']>([
  'price_list',
  'textarea',
]);

function conversationalPrefix(questionNumber: number, businessName?: string): string {
  if (questionNumber <= 1) return '';
  // Use the name only on Q2 so it feels like the bot "remembers" the first answer
  // without spamming it on every message.
  if (questionNumber === 2 && businessName) {
    return `Perfecto, ${businessName}. `;
  }
  const connector = CONNECTORS[(questionNumber - 2) % CONNECTORS.length];
  return `${connector} `;
}

export function getNextQuestion(
  vertical: VerticalEnum,
  questionNumber: number,
  businessName?: string,
): FormattedQuestion | null {
  const questions = getVerticalQuestions(vertical);
  if (questions.length === 0 || questionNumber > questions.length) return null;

  const q = questions[questionNumber - 1];
  if (!q) return null;

  // Lower-case the first char of the original question so it flows after
  // the conversational prefix (e.g. "Perfecto. cuentame..."). If there's
  // no prefix we keep the original capitalization.
  const prefix = conversationalPrefix(questionNumber, businessName);
  const body = prefix ? q.text.charAt(0).toLowerCase() + q.text.slice(1) : q.text;
  const text = `${prefix}${body}`;

  return {
    questionNumber,
    totalQuestions: questions.length,
    text,
    why: q.why,
    inputType: q.inputType,
    required: q.required,
    followUpInsight: q.followUpInsight,
    isLastQuestion: questionNumber === questions.length,
    acceptsUpload: UPLOAD_INPUT_TYPES.has(q.inputType),
  };
}

export function getTotalQuestions(vertical: VerticalEnum): number {
  return getVerticalQuestions(vertical).length;
}

// Backwards-compat helper — returns the same conversational text.
// The old "Pregunta X/Y:" format is gone; the UI shows progress separately.
export function formatQuestionMessage(q: FormattedQuestion): string {
  return q.text;
}

// Format insight message after an answer
export function formatInsightMessage(q: FormattedQuestion): string | null {
  if (!q.followUpInsight) return null;
  return q.followUpInsight;
}
