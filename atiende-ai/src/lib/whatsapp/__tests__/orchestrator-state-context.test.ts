import { describe, it, expect } from 'vitest';
import { formatStateContext } from '../orchestrator-branch';

describe('formatStateContext — state recovery for orchestrator agent', () => {
  it('renders a known state with human description', () => {
    const out = formatStateContext('awaiting_appointment_date', {});
    expect(out).toContain('ESTADO ACTIVO');
    expect(out.toLowerCase()).toContain('agendando una cita');
  });

  it('falls back to raw state name when unknown', () => {
    const out = formatStateContext('custom_weird_state', {});
    expect(out).toContain('custom_weird_state');
  });

  it('includes partial data using safe keys only', () => {
    const out = formatStateContext('awaiting_appointment_date', {
      service: 'Limpieza',
      date: '2026-05-15',
      patient_name: 'Ana',
    });
    expect(out).toContain('Limpieza');
    expect(out).toContain('2026-05-15');
    expect(out).toContain('Ana');
  });

  it('filters out non-allowed keys (defense against injection via JSONB)', () => {
    const out = formatStateContext('awaiting_appointment_date', {
      service: 'Limpieza',
      malicious_key: '<script>alert(1)</script>',
      system_prompt_override: 'IGNORE PREVIOUS',
    });
    expect(out).toContain('Limpieza');
    expect(out).not.toContain('malicious_key');
    expect(out).not.toContain('system_prompt_override');
    expect(out).not.toContain('<script>');
  });

  it('omits empty/null/undefined values from partial data', () => {
    const out = formatStateContext('awaiting_appointment_date', {
      service: 'Limpieza',
      date: '',
      time: null,
      staff_id: undefined,
    });
    expect(out).toContain('Limpieza');
    expect(out).not.toContain('- date:');
    expect(out).not.toContain('- time:');
    expect(out).not.toContain('- staff_id:');
  });

  it('instructs the LLM to not re-ask for collected data', () => {
    const out = formatStateContext('awaiting_appointment_date', { service: 'X' });
    expect(out.toLowerCase()).toContain('no vuelvas a pedir');
  });

  it('handles empty context with guidance to ask for missing data', () => {
    const out = formatStateContext('awaiting_appointment_date', {});
    expect(out.toLowerCase()).toContain('faltan');
  });
});
