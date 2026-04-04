// Question Engine — asks questions one-by-one conversationally
// Formats questions naturally using business name after Q1

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

  // Personalize question text with business name after Q1
  let text = q.text;
  if (businessName && questionNumber > 1) {
    // For Q2 onwards, add context
    if (questionNumber === 2) {
      text = `Perfecto, ${businessName}. Ahora dime: ${q.text}`;
    }
  }

  return {
    questionNumber,
    totalQuestions: questions.length,
    text,
    why: q.why,
    inputType: q.inputType,
    required: q.required,
    followUpInsight: q.followUpInsight,
    isLastQuestion: questionNumber === questions.length,
  };
}

export function getTotalQuestions(vertical: VerticalEnum): number {
  return getVerticalQuestions(vertical).length;
}

// Format the AI message for a question
export function formatQuestionMessage(q: FormattedQuestion): string {
  return `Pregunta ${q.questionNumber}/${q.totalQuestions}: ${q.text}`;
}

// Format insight message after an answer
export function formatInsightMessage(q: FormattedQuestion): string | null {
  if (!q.followUpInsight) return null;
  return q.followUpInsight;
}
