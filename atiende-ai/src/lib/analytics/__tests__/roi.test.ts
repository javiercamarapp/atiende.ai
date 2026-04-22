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

  it('free_trial → 300 (central config)', () => {
    expect(getPlanLimit('free_trial')).toBe(300);
  });

  it('plan desconocido → free_trial fallback (300)', () => {
    expect(getPlanLimit('unknown')).toBe(300);
  });

  it('string vacío → free_trial fallback (300)', () => {
    expect(getPlanLimit('')).toBe(300);
  });
});
