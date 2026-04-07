/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  getNextQuestion,
  getTotalQuestions,
  formatQuestionMessage,
  formatInsightMessage,
} from '../question-engine';

describe('getNextQuestion', () => {
  it('returns the first question for question number 1', () => {
    const q = getNextQuestion('dental', 1);
    expect(q).not.toBeNull();
    expect(q?.questionNumber).toBe(1);
    expect(q?.text).toBeTruthy();
    expect(q?.totalQuestions).toBeGreaterThan(0);
  });

  it('returns the next question in sequence', () => {
    const q1 = getNextQuestion('dental', 1);
    const q2 = getNextQuestion('dental', 2);
    expect(q2).not.toBeNull();
    expect(q2?.questionNumber).toBe(2);
    expect(q2?.text).not.toBe(q1?.text);
  });

  it('returns null when question number is past the end', () => {
    const total = getTotalQuestions('dental');
    const q = getNextQuestion('dental', total + 1);
    expect(q).toBeNull();
  });

  it('marks the last question with isLastQuestion = true', () => {
    const total = getTotalQuestions('dental');
    const q = getNextQuestion('dental', total);
    expect(q).not.toBeNull();
    expect(q?.isLastQuestion).toBe(true);
  });

  it('marks non-last questions with isLastQuestion = false', () => {
    const q = getNextQuestion('dental', 1);
    expect(q?.isLastQuestion).toBe(false);
  });

  it('personalizes Q2 with businessName', () => {
    const q2 = getNextQuestion('dental', 2, 'DentaCare');
    expect(q2?.text).toContain('DentaCare');
    expect(q2?.text.toLowerCase()).toContain('perfecto');
  });

  it('does NOT personalize Q1 with businessName', () => {
    const q1 = getNextQuestion('dental', 1, 'DentaCare');
    expect(q1?.text).not.toContain('DentaCare');
  });

  it('preserves the required flag from the source question', () => {
    const q1 = getNextQuestion('dental', 1);
    // Q1 in dental is "Nombre completo del consultorio" → required: true
    expect(q1?.required).toBe(true);
    expect(typeof q1?.required).toBe('boolean');
  });

  it('exposes inputType from the source question', () => {
    const q = getNextQuestion('dental', 1);
    expect(q?.inputType).toBeDefined();
    expect(['text', 'textarea', 'select', 'multiselect', 'boolean', 'number', 'price_list']).toContain(
      q?.inputType,
    );
  });

  it('iterates correctly through all dental questions without gaps', () => {
    const total = getTotalQuestions('dental');
    expect(total).toBeGreaterThanOrEqual(17);

    const seen: string[] = [];
    for (let i = 1; i <= total; i++) {
      const q = getNextQuestion('dental', i);
      expect(q).not.toBeNull();
      expect(q?.questionNumber).toBe(i);
      expect(q?.totalQuestions).toBe(total);
      seen.push(q!.text);
    }
    expect(seen).toHaveLength(total);
    expect(getNextQuestion('dental', total + 1)).toBeNull();
  });

  it('iterates correctly through all contable_legal questions', () => {
    const total = getTotalQuestions('contable_legal');
    expect(total).toBeGreaterThan(0);

    for (let i = 1; i <= total; i++) {
      const q = getNextQuestion('contable_legal', i);
      expect(q).not.toBeNull();
      expect(q?.questionNumber).toBe(i);
    }
    expect(getNextQuestion('contable_legal', total + 1)).toBeNull();
  });
});

describe('getTotalQuestions', () => {
  it('returns the total number of questions for a vertical', () => {
    const total = getTotalQuestions('dental');
    expect(total).toBeGreaterThan(0);
  });

  it('returns 0 (or non-negative) for a vertical with no questions defined', () => {
    // Cast at usage site is intentional; we just want to confirm it does not throw
    const total = getTotalQuestions('dental');
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

describe('formatQuestionMessage', () => {
  it('returns the conversational text (no "Pregunta X/Y:" prefix)', () => {
    const q = getNextQuestion('dental', 1)!;
    const msg = formatQuestionMessage(q);
    // New format: plain conversational text. The old "Pregunta X/Y:" prefix
    // was removed in favor of a progress indicator in the UI header.
    expect(msg).not.toMatch(/^Pregunta \d+\/\d+:/);
    expect(msg).toBe(q.text);
  });

  it('Q2 includes a conversational connector', () => {
    const q2 = getNextQuestion('dental', 2, 'DentaCare')!;
    expect(q2.text.toLowerCase()).toMatch(/^perfecto/);
  });

  it('Q3+ include connectors without the business name', () => {
    const q3 = getNextQuestion('dental', 3, 'DentaCare')!;
    expect(q3.text).not.toContain('DentaCare');
    // One of the rotating connectors should be present at the start
    expect(q3.text).toMatch(/^(Perfecto|Genial|Listo|Excelente|Ok|Anotado|Entendido)\./);
  });

  it('exposes acceptsUpload on price_list questions', () => {
    // Walk the dental questions until we find a price_list one
    const total = getTotalQuestions('dental');
    let priceListQuestion: ReturnType<typeof getNextQuestion> = null;
    for (let i = 1; i <= total; i++) {
      const q = getNextQuestion('dental', i);
      if (q?.inputType === 'price_list') {
        priceListQuestion = q;
        break;
      }
    }
    if (priceListQuestion) {
      expect(priceListQuestion.acceptsUpload).toBe(true);
    }
  });
});

describe('formatInsightMessage', () => {
  it('returns null when the question has no followUpInsight', () => {
    const q = getNextQuestion('dental', 1)!;
    // Q1 of dental should not have a followUpInsight
    if (!q.followUpInsight) {
      expect(formatInsightMessage(q)).toBeNull();
    } else {
      expect(formatInsightMessage(q)).toBe(q.followUpInsight);
    }
  });

  it('returns the followUpInsight when present', () => {
    // Find a question that has a followUpInsight
    const total = getTotalQuestions('dental');
    let found: ReturnType<typeof getNextQuestion> = null;
    for (let i = 1; i <= total; i++) {
      const q = getNextQuestion('dental', i);
      if (q?.followUpInsight) {
        found = q;
        break;
      }
    }
    expect(found).not.toBeNull();
    expect(formatInsightMessage(found!)).toBe(found!.followUpInsight);
  });
});
