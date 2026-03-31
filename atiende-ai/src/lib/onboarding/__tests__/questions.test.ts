import { describe, it, expect } from 'vitest';
import { getQuestions, QUESTIONS, DEFAULT_QUESTIONS, type Question } from '../questions';

describe('getQuestions', () => {
  it('dental returns 10+ questions', () => {
    const q = getQuestions('dental');
    expect(q.length).toBeGreaterThanOrEqual(10);
  });

  it('restaurant returns 10+ questions', () => {
    const q = getQuestions('restaurant');
    expect(q.length).toBeGreaterThanOrEqual(10);
  });

  it('psychologist returns 7+ questions', () => {
    const q = getQuestions('psychologist');
    expect(q.length).toBeGreaterThanOrEqual(7);
  });

  it('salon returns 6+ questions', () => {
    const q = getQuestions('salon');
    expect(q.length).toBeGreaterThanOrEqual(6);
  });

  it('real_estate returns 6+ questions', () => {
    const q = getQuestions('real_estate');
    expect(q.length).toBeGreaterThanOrEqual(6);
  });

  it('hotel returns 8+ questions', () => {
    const q = getQuestions('hotel');
    expect(q.length).toBeGreaterThanOrEqual(8);
  });

  it('veterinary returns 6+ questions', () => {
    const q = getQuestions('veterinary');
    expect(q.length).toBeGreaterThanOrEqual(6);
  });

  it('gym returns 5+ questions', () => {
    const q = getQuestions('gym');
    expect(q.length).toBeGreaterThanOrEqual(5);
  });

  it('medical returns specific questions (not default)', () => {
    const q = getQuestions('medical');
    expect(q).not.toEqual(DEFAULT_QUESTIONS);
    expect(q.length).toBeGreaterThan(DEFAULT_QUESTIONS.length);
  });

  it('nutritionist returns specific questions', () => {
    const q = getQuestions('nutritionist');
    expect(q).not.toEqual(DEFAULT_QUESTIONS);
    expect(q.some((q) => q.key === 'meal_plans' || q.key === 'specialties')).toBe(true);
  });

  it('unknown type returns DEFAULT_QUESTIONS', () => {
    const q = getQuestions('space_station');
    expect(q).toEqual(DEFAULT_QUESTIONS);
  });

  it('all questions have key, label, and type', () => {
    for (const [biz, questions] of Object.entries(QUESTIONS)) {
      for (const q of questions) {
        expect(q.key, `${biz}.key`).toBeTruthy();
        expect(q.label, `${biz}.label`).toBeTruthy();
        expect(q.type, `${biz}.type`).toBeTruthy();
      }
    }
  });

  it('required questions have required: true', () => {
    for (const [biz, questions] of Object.entries(QUESTIONS)) {
      const required = questions.filter((q) => q.required);
      expect(required.length, `${biz} should have at least 1 required question`).toBeGreaterThan(0);
      for (const q of required) {
        expect(q.required).toBe(true);
      }
    }
  });

  it('multi_select questions have options array', () => {
    for (const [biz, questions] of Object.entries(QUESTIONS)) {
      const multiSelects = questions.filter((q) => q.type === 'multi_select');
      for (const q of multiSelects) {
        expect(
          Array.isArray(q.options),
          `${biz}.${q.key} multi_select should have options array`
        ).toBe(true);
        expect(q.options!.length).toBeGreaterThan(0);
      }
    }
  });

  it('boolean questions may have followUp', () => {
    const allBooleans: Question[] = [];
    for (const questions of Object.values(QUESTIONS)) {
      allBooleans.push(...questions.filter((q) => q.type === 'boolean'));
    }
    // At least some boolean questions should have followUp
    const withFollowUp = allBooleans.filter((q) => q.followUp);
    expect(withFollowUp.length).toBeGreaterThan(0);
    // followUp should be a string
    for (const q of withFollowUp) {
      expect(typeof q.followUp).toBe('string');
    }
  });
});
