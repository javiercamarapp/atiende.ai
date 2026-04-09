// TODO(onboarding-v2): deprecated — answer validation now happens inside the
// conversational agent (src/lib/onboarding/chat-agent.ts). Delete in a
// follow-up PR once the new flow is validated in prod.
//
// Answer Processor — validates and stores onboarding answers

import type { VerticalQuestion } from '@/lib/verticals/types';
import { getVerticalQuestions } from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';

export interface ProcessedAnswer {
  isValid: boolean;
  errorMessage?: string;
  questionKey: string;
  value: string;
}

export function processAnswer(
  vertical: VerticalEnum,
  questionNumber: number,
  answer: string,
): ProcessedAnswer {
  const questions = getVerticalQuestions(vertical);
  const q = questions[questionNumber - 1];

  if (!q) {
    return { isValid: false, errorMessage: 'Pregunta no encontrada.', questionKey: '', value: '' };
  }

  const trimmed = answer.trim();
  const questionKey = `q${questionNumber}`;

  // Validate required
  if (q.required && trimmed.length === 0) {
    return {
      isValid: false,
      errorMessage: 'Esta pregunta es obligatoria. Por favor responde para continuar.',
      questionKey,
      value: '',
    };
  }

  // Validate by input type
  if (trimmed.length > 0) {
    const validation = validateByType(q, trimmed);
    if (!validation.isValid) {
      return { isValid: false, errorMessage: validation.errorMessage, questionKey, value: '' };
    }
  }

  return { isValid: true, questionKey, value: trimmed };
}

function validateByType(q: VerticalQuestion, value: string): { isValid: boolean; errorMessage?: string } {
  switch (q.inputType) {
    case 'number':
      if (isNaN(Number(value))) {
        return { isValid: false, errorMessage: 'Por favor ingresa un numero valido.' };
      }
      break;
    case 'boolean':
      // Accept si/no, yes/no, or any text (it's conversational)
      break;
    case 'text':
      if (value.length < 2) {
        return { isValid: false, errorMessage: 'La respuesta es muy corta. Por favor da mas detalle.' };
      }
      break;
    case 'textarea':
    case 'price_list':
      if (value.length < 5) {
        return { isValid: false, errorMessage: 'Por favor da mas detalle en tu respuesta.' };
      }
      break;
  }
  return { isValid: true };
}

// Extract business name from Q1 answer
export function extractBusinessName(answers: Record<string, string>): string | undefined {
  return answers['q1'] || undefined;
}
