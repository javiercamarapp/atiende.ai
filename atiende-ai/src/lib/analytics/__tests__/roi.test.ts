import { describe, it, expect } from 'vitest';
import { getPlanLimit } from '../roi';

describe('getPlanLimit()', () => {
  it('basic → 500', () => {
    expect(getPlanLimit('basic')).toBe(500);
  });

  it('pro → 2000', () => {
    expect(getPlanLimit('pro')).toBe(2000);
  });

  it('premium → unlimited (999999)', () => {
    expect(getPlanLimit('premium')).toBe(999999);
  });

  it('free_trial → 100', () => {
    expect(getPlanLimit('free_trial')).toBe(100);
  });

  it('plan desconocido → 100 (default)', () => {
    expect(getPlanLimit('unknown')).toBe(100);
  });

  it('string vacío → 100', () => {
    expect(getPlanLimit('')).toBe(100);
  });
});
