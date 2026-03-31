import { describe, it, expect } from 'vitest';
import { getChatTemplate } from '../chat/index';

describe('getChatTemplate', () => {
  it('dental contains "NUNCA diagnosticar" variant', () => {
    const t = getChatTemplate('dental');
    expect(t).toContain('NUNCA diagnostiques');
  });

  it('medical contains guardrails', () => {
    const t = getChatTemplate('medical');
    expect(t).toContain('GUARDRAILS');
    expect(t).toContain('NUNCA diagnostiques');
    expect(t).toContain('NUNCA recomiendes medicamentos');
  });

  it('psychologist contains "Linea de la Vida"', () => {
    const t = getChatTemplate('psychologist');
    expect(t).toContain('Linea de la Vida');
  });

  it('restaurant contains "alergias"', () => {
    const t = getChatTemplate('restaurant');
    expect(t).toContain('alergias');
  });

  it('salon contains "estilista"', () => {
    const t = getChatTemplate('salon');
    expect(t).toContain('estilista');
  });

  it('real_estate contains "BANT"', () => {
    const t = getChatTemplate('real_estate');
    expect(t).toContain('BANT');
  });

  it('hotel contains "bilingue" variant', () => {
    const t = getChatTemplate('hotel');
    // The template uses BILINGUE in caps
    expect(t.toLowerCase()).toContain('bilingue');
  });

  it('veterinary contains "traiga a su mascota" variant', () => {
    const t = getChatTemplate('veterinary');
    expect(t.toLowerCase()).toContain('traiga a su mascota');
  });

  it('unknown type returns generic template', () => {
    const t = getChatTemplate('alien_shop');
    expect(t).toContain('asistente virtual');
    expect(t).not.toContain('GUARDRAILS');
  });

  it('all templates contain "usted" (formal Spanish)', () => {
    const types = ['dental', 'medical', 'psychologist', 'restaurant', 'salon', 'real_estate', 'hotel', 'veterinary', 'gym'];
    for (const type of types) {
      const t = getChatTemplate(type);
      expect(t, `${type} template should contain "usted"`).toContain('usted');
    }
  });
});
