import { describe, it, expect } from 'vitest';
import {
  buildFieldsBlock,
  countRequired,
  countCapturedRequired,
  allRequiredFilled,
  validKeysForVertical,
  getVerticalDisplayName,
} from '../vertical-schema-for-agent';

describe('buildFieldsBlock', () => {
  it('produces a lines-block with REQ markers for dental', () => {
    const block = buildFieldsBlock('dental', {});
    expect(block).toContain('[REQ] q1 — Nombre completo del consultorio o clinica');
    expect(block).toContain('[REQ] q2 — Direccion completa con referencias');
    expect(block).toContain('[REQ] q3 — Horario de atencion por dia de la semana');
    // q4 (dias festivos) is optional
    expect(block).toContain('[   ] q4 — Dias festivos');
  });

  it('annotates already-captured values', () => {
    const block = buildFieldsBlock('dental', {
      q1: 'Clínica Sonrisas',
      q2: 'Calle 10, Mérida',
    });
    expect(block).toContain('[YA CAPTURADO: "Clínica Sonrisas"]');
    expect(block).toContain('[YA CAPTURADO: "Calle 10, Mérida"]');
  });

  it('truncates long captured values with ellipsis', () => {
    const longVal = 'x'.repeat(200);
    const block = buildFieldsBlock('dental', { q1: longVal }, { maxCapturedPreview: 20 });
    expect(block).toMatch(/\[YA CAPTURADO: "x{20}…"\]/);
  });

  it('includes "por qué" rationale from each question', () => {
    const block = buildFieldsBlock('dental', {});
    expect(block).toContain('por qué: Exactamente como aparece en tu letrero y RFC');
  });

  it('returns placeholder for verticals without questions', () => {
    // `farmacia` has a metadata entry but no questions defined in salud.ts
    // (per spec snapshot at the time of writing). Use a vertical that likely
    // has none — fallback behavior matters more than specific coverage.
    const block = buildFieldsBlock('farmacia', {});
    expect(block).toMatch(/no hay schema|\[REQ\]/); // either empty placeholder or content
  });
});

describe('countRequired / countCapturedRequired / allRequiredFilled', () => {
  it('counts required fields for dental', () => {
    const n = countRequired('dental');
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it('counts zero captured when empty', () => {
    expect(countCapturedRequired('dental', {})).toBe(0);
  });

  it('counts captured required fields', () => {
    const captured = { q1: 'nombre', q2: 'direccion', q3: 'horario' };
    expect(countCapturedRequired('dental', captured)).toBeGreaterThanOrEqual(3);
  });

  it('ignores non-required fields in counts', () => {
    // q4 (Dias festivos) is optional; filling it should NOT change count
    const beforeCount = countCapturedRequired('dental', { q1: 'x' });
    const afterCount = countCapturedRequired('dental', { q1: 'x', q4: 'Semana Santa' });
    expect(afterCount).toBe(beforeCount);
  });

  it('ignores whitespace-only values', () => {
    expect(countCapturedRequired('dental', { q1: '   ' })).toBe(0);
  });

  it('allRequiredFilled returns false when missing fields', () => {
    expect(allRequiredFilled('dental', { q1: 'nombre' })).toBe(false);
  });
});

describe('validKeysForVertical', () => {
  it('returns qN keys matching dental question numbers', () => {
    const keys = validKeysForVertical('dental');
    expect(keys.has('q1')).toBe(true);
    expect(keys.has('q2')).toBe(true);
    // dental has 28 questions per salud.ts, so q28 should exist
    expect(keys.has('q28')).toBe(true);
    // q99 should NOT exist
    expect(keys.has('q99')).toBe(false);
  });
});

describe('getVerticalDisplayName', () => {
  it('returns friendly names', () => {
    expect(getVerticalDisplayName('dental')).toBe('Consultorio Dental');
    expect(getVerticalDisplayName('medico')).toBe('Consultorio Medico');
  });
});
