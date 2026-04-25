import { describe, it, expect } from 'vitest';
import { AGENT_REGISTRY } from '../registry';
import { routeToAgent, buildTenantContext } from '../index';
import type { TenantContext } from '../types';

describe('AGENT_REGISTRY', () => {
  it('contiene los 13 agentes esperados', () => {
    const expected = [
      'orchestrator', 'agenda', 'no-show', 'faq',
      'post-consulta', 'encuesta', 'medicamento', 'intake',
      'retencion', 'agenda-gap', 'reputacion', 'cobranza', 'triaje',
    ];
    for (const agent of expected) {
      expect(AGENT_REGISTRY[agent as keyof typeof AGENT_REGISTRY]).toBeDefined();
    }
  });

  it('cada agente tiene model + tools array + systemPromptKey', () => {
    for (const [name, config] of Object.entries(AGENT_REGISTRY)) {
      expect(config.name).toBe(name);
      expect(config.model).toBeTypeOf('string');
      expect(Array.isArray(config.tools)).toBe(true);
      expect(config.systemPromptKey).toBeTypeOf('string');
    }
  });

  it('faq no tiene modelo LLM (responde con regex)', () => {
    expect(AGENT_REGISTRY.faq.model).toBe('none');
    expect(AGENT_REGISTRY.faq.tools).toEqual([]);
  });

  it('agenda tiene las 5 tools core', () => {
    const tools = AGENT_REGISTRY.agenda.tools;
    expect(tools).toContain('check_availability');
    expect(tools).toContain('book_appointment');
    expect(tools).toContain('cancel_appointment');
    expect(tools).toContain('modify_appointment');
    expect(tools).toContain('get_my_appointments');
  });
});

describe('routeToAgent()', () => {
  const ctx: TenantContext = {
    tenantId: 'test',
    businessName: 'test',
    businessType: 'dental',
    businessCity: 'Mérida',
    businessHours: {},
    timezone: 'America/Merida',
    services: [],
    agentName: 'Sofía',
    currentDatetime: '2026-04-14 10:00',
    tomorrowDate: '2026-04-15',
    dayAfterTomorrow: '2026-04-16',
    nextWeekStart: '2026-04-21',
  };

  it('detecta urgencia con "emergencia"', () => {
    expect(routeToAgent('tengo una emergencia', ctx)).toBe('urgent');
  });

  it('detecta urgencia con "dolor severo"', () => {
    expect(routeToAgent('tengo dolor severo', ctx)).toBe('urgent');
  });

  it('detecta urgencia ignorando acentos', () => {
    expect(routeToAgent('estoy en crisis', ctx)).toBe('urgent');
  });

  it('detecta FAQ con "horario"', () => {
    expect(routeToAgent('¿cuál es su horario?', ctx)).toBe('faq');
  });

  it('detecta FAQ con "precio"', () => {
    expect(routeToAgent('cuánto cuesta una limpieza', ctx)).toBe('faq');
  });

  it('retorna null para mensajes complejos (LLM decide)', () => {
    expect(routeToAgent('quiero agendar una cita con la dra', ctx)).toBeNull();
  });

  it('retorna null para saludos', () => {
    expect(routeToAgent('hola', ctx)).toBeNull();
  });
});

describe('buildTenantContext()', () => {
  it('extrae campos básicos del row del tenant', () => {
    const tenant = {
      id: 'fab31042-fba2-4321-8b15-814a4cdff931',
      name: 'Dra. Marilú',
      business_type: 'dental',
      city: 'Mérida',
      timezone: 'America/Merida',
      business_hours: {},
      services: [],
    };
    const ctx = buildTenantContext(tenant);
    expect(ctx.tenantId).toBe(tenant.id);
    expect(ctx.businessName).toBe('Dra. Marilú');
    expect(ctx.businessType).toBe('dental');
    expect(ctx.businessCity).toBe('Mérida');
    expect(ctx.timezone).toBe('America/Merida');
  });

  it('default timezone es America/Mexico_City si tenant no lo tiene configurado', () => {
    // Cambiado de America/Merida → America/Mexico_City en Phase 2
    // (resolveTenantTimezone) porque el ~70% de tenants mexicanos están en
    // CDMX y caer a Mérida les daba 1h de offset silencioso en citas.
    const ctx = buildTenantContext({ id: 't', name: 'n' });
    expect(ctx.timezone).toBe('America/Mexico_City');
  });

  it('tomorrowDate siempre es futuro respecto a currentDatetime', () => {
    const ctx = buildTenantContext({ id: 't', name: 'n', timezone: 'America/Merida' });
    // Formato YYYY-MM-DD
    expect(ctx.tomorrowDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.dayAfterTomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.tomorrowDate < ctx.dayAfterTomorrow).toBe(true);
  });

  it('parsea servicios del formato tenant', () => {
    const ctx = buildTenantContext({
      id: 't',
      name: 'n',
      services: [{ name: 'Limpieza', price: 299, duration_minutes: 30 }],
    });
    expect(ctx.services[0]).toEqual({ name: 'Limpieza', price: 299, duration: 30 });
  });
});
