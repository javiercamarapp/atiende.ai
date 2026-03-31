import { describe, it, expect } from 'vitest';
import { calculateStage } from '../journey';

describe('calculateStage', () => {
  it('100+ days no contact returns churned', () => {
    expect(calculateStage(100, 5)).toBe('churned');
  });

  it('91 days no contact returns churned', () => {
    expect(calculateStage(91, 15)).toBe('churned');
  });

  it('60 days no contact returns at-risk', () => {
    expect(calculateStage(60, 5)).toBe('at-risk');
  });

  it('15 interactions and recent contact returns loyal', () => {
    expect(calculateStage(5, 15)).toBe('loyal');
  });

  it('5 interactions and recent contact returns active', () => {
    expect(calculateStage(5, 5)).toBe('active');
  });

  it('1 interaction returns new', () => {
    expect(calculateStage(1, 1)).toBe('new');
  });

  it('boundary: exactly 90 days is at-risk not churned', () => {
    // 90 is not > 90, so not churned. 90 > 30 so at-risk
    expect(calculateStage(90, 5)).toBe('at-risk');
  });

  it('boundary: exactly 30 days with 11 interactions is loyal', () => {
    // 30 is not > 30, so not at-risk; 11 > 10 so loyal
    expect(calculateStage(30, 11)).toBe('loyal');
  });
});
