import { describe, it, expect } from 'vitest';
import { SUB_VERTICALS, getSubVerticalsFor, isValidSubVertical } from '../sub-verticals';

describe('sub-verticals', () => {
  it('returns the defined list for a known vertical', () => {
    expect(getSubVerticalsFor('dental')).toContain('orthodontics');
    expect(getSubVerticalsFor('restaurant')).toContain('taqueria');
  });

  it('returns empty array for unknown vertical', () => {
    expect(getSubVerticalsFor('martian_cuisine')).toEqual([]);
  });

  it('validates membership correctly', () => {
    expect(isValidSubVertical('dental', 'orthodontics')).toBe(true);
    expect(isValidSubVertical('dental', 'taqueria')).toBe(false);
    expect(isValidSubVertical('unknown', 'anything')).toBe(false);
  });

  it('covers every business_type listed in SUB_VERTICALS', () => {
    for (const key of Object.keys(SUB_VERTICALS)) {
      expect(SUB_VERTICALS[key].length).toBeGreaterThan(0);
    }
  });
});
