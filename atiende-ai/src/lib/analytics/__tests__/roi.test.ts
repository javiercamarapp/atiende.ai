import { describe, it, expect } from 'vitest';
import { getPlanLimit } from '../roi';

describe('getPlanLimit()', () => {
  // v4: todos los planes son ilimitados. La función devuelve 999_999
  // como sentinel "unlimited" para que dashboards que dividen por el cap
  // no exploten con Infinity.
  const UNLIMITED = 999_999;

  it('basic → unlimited', () => {
    expect(getPlanLimit('basic')).toBe(UNLIMITED);
  });

  it('pro → unlimited', () => {
    expect(getPlanLimit('pro')).toBe(UNLIMITED);
  });

  it('premium → unlimited', () => {
    expect(getPlanLimit('premium')).toBe(UNLIMITED);
  });

  it('free_trial → unlimited (primer mes gratis con tarjeta)', () => {
    expect(getPlanLimit('free_trial')).toBe(UNLIMITED);
  });

  it('plan desconocido → free_trial fallback (unlimited)', () => {
    expect(getPlanLimit('unknown')).toBe(UNLIMITED);
  });

  it('string vacío → free_trial fallback (unlimited)', () => {
    expect(getPlanLimit('')).toBe(UNLIMITED);
  });
});
