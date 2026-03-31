import { describe, it, expect } from 'vitest';
import { calculateStage } from '../journey';

describe('calculateStage()', () => {
  it('100+ días sin contacto → churned', () => {
    expect(calculateStage(100, 5)).toBe('churned');
  });

  it('91 días → churned', () => {
    expect(calculateStage(91, 20)).toBe('churned');
  });

  it('60 días sin contacto → at-risk', () => {
    expect(calculateStage(60, 5)).toBe('at-risk');
  });

  it('31 días → at-risk', () => {
    expect(calculateStage(31, 3)).toBe('at-risk');
  });

  it('15 interacciones recientes → loyal', () => {
    expect(calculateStage(5, 15)).toBe('loyal');
  });

  it('5 interacciones recientes → active', () => {
    expect(calculateStage(5, 5)).toBe('active');
  });

  it('3 interacciones → active', () => {
    expect(calculateStage(10, 3)).toBe('active');
  });

  it('1 interacción → new', () => {
    expect(calculateStage(1, 1)).toBe('new');
  });

  it('0 interacciones → new', () => {
    expect(calculateStage(0, 0)).toBe('new');
  });
});
