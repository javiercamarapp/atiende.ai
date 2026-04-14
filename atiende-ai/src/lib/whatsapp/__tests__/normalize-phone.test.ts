import { describe, it, expect } from 'vitest';
import { normalizePhoneMx } from '../normalize-phone';

describe('normalizePhoneMx()', () => {
  it('agrega 521 a número MX de 10 dígitos', () => {
    expect(normalizePhoneMx('9991234567')).toBe('5219991234567');
  });

  it('limpia + y espacios en formato internacional', () => {
    expect(normalizePhoneMx('+52 999 123 4567')).toBe('5219991234567');
  });

  it('limpia guiones y convierte 52 → 521', () => {
    expect(normalizePhoneMx('52 999-123-4567')).toBe('5219991234567');
  });

  it('deja intacto número ya en formato WA (13 dígitos)', () => {
    expect(normalizePhoneMx('5219991234567')).toBe('5219991234567');
  });

  it('limpia + de formato completo 529...', () => {
    expect(normalizePhoneMx('+529991234567')).toBe('5219991234567');
  });

  it('agrega "1" al formato 52 + 10 dígitos', () => {
    expect(normalizePhoneMx('529991234567')).toBe('5219991234567');
  });

  it('retorna string vacío para input vacío', () => {
    expect(normalizePhoneMx('')).toBe('');
    expect(normalizePhoneMx('   ')).toBe('');
  });

  it('preserva números internacionales no-MX', () => {
    expect(normalizePhoneMx('+1 415 555 1234')).toBe('14155551234');
  });

  it('maneja parentesis como en (999) 123-4567', () => {
    expect(normalizePhoneMx('(999) 123-4567')).toBe('5219991234567');
  });
});
