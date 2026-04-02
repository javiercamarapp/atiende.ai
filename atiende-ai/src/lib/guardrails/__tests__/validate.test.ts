import { describe, it, expect } from 'vitest';
import { validateResponse } from '../validate';

// ── Helpers ──────────────────────────────────────────────────

function makeTenant(businessType: string, name = 'TestBiz') {
  return { business_type: businessType, name };
}

// ── CAPA 1: Price validation ────────────────────────────────

describe('validateResponse — price validation', () => {
  const tenant = makeTenant('restaurant');

  it('allows prices that exist in RAG context', () => {
    const result = validateResponse(
      'El servicio cuesta $800 MXN.',
      tenant,
      'Corte de cabello $800 MXN'
    );
    expect(result.valid).toBe(true);
    expect(result.text).toContain('$800');
  });

  it('rejects prices that are NOT in RAG context (hallucinated price)', () => {
    const result = validateResponse(
      'El servicio cuesta $999 MXN.',
      tenant,
      'Corte de cabello $800 MXN'
    );
    expect(result.valid).toBe(false);
    expect(result.text).toContain('precios exactos');
  });

  it('matches price by numeric value without dollar sign in context', () => {
    const result = validateResponse(
      'El precio es $500.',
      tenant,
      'Limpieza dental 500 pesos'
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when one of multiple prices is hallucinated', () => {
    const result = validateResponse(
      'Tenemos $200 y $999.',
      tenant,
      'Servicio A $200'
    );
    expect(result.valid).toBe(false);
  });

  it('passes when response has no prices at all', () => {
    const result = validateResponse(
      'Bienvenido, en que le puedo ayudar?',
      tenant,
      ''
    );
    expect(result.valid).toBe(true);
  });
});

// ── CAPA 2: Medical guardrails ──────────────────────────────

describe('validateResponse — medical guardrails', () => {
  const dentalTenant = makeTenant('dental', 'DentaCare');
  const medicalTenant = makeTenant('medical', 'ClinicaMX');
  const shopTenant = makeTenant('retail', 'TiendaMX');

  it('blocks "diagnostico" for dental tenants', () => {
    const result = validateResponse(
      'El diagnostico es una caries.',
      dentalTenant,
      ''
    );
    expect(result.valid).toBe(false);
    expect(result.text).toContain('equipo');
    expect(result.text).toContain('cita');
  });

  it('blocks "le recomiendo tomar" for medical tenants', () => {
    const result = validateResponse(
      'Le recomiendo tomar ibuprofeno.',
      medicalTenant,
      ''
    );
    expect(result.valid).toBe(false);
  });

  it('blocks "probablemente tiene" for medical tenants', () => {
    const result = validateResponse(
      'Probablemente tiene una infeccion.',
      medicalTenant,
      ''
    );
    expect(result.valid).toBe(false);
  });

  it('blocks "mg de" for medical tenants', () => {
    const result = validateResponse(
      'Tome 500 mg de acetaminofen.',
      medicalTenant,
      ''
    );
    expect(result.valid).toBe(false);
  });

  it('blocks "deberia usar" for dental tenants', () => {
    const result = validateResponse(
      'Deberia usar hilo dental 3 veces al dia.',
      dentalTenant,
      ''
    );
    expect(result.valid).toBe(false);
  });

  it('does NOT block medical terms for non-health tenants', () => {
    const result = validateResponse(
      'El diagnostico del auto es que necesita frenos.',
      shopTenant,
      'diagnostico automotriz'
    );
    expect(result.valid).toBe(true);
  });

  it('blocks all forbidden phrases for health types', () => {
    const forbidden = [
      'diagnostico', 'le recomiendo tomar', 'probablemente tiene',
      'mg de', 'es normal que', 'deberia usar', 'apliquese',
      'inyectese', 'no se preocupe', 'seguramente es',
      'parece ser', 'podria ser un caso de',
    ];
    for (const phrase of forbidden) {
      const result = validateResponse(
        `Blah ${phrase} blah.`,
        medicalTenant,
        `${phrase}`
      );
      expect(result.valid).toBe(false);
    }
  });

  it('applies to all health business types', () => {
    const types = [
      'dental', 'medical', 'nutritionist', 'psychologist',
      'dermatologist', 'gynecologist', 'pediatrician', 'ophthalmologist',
    ];
    for (const type of types) {
      const result = validateResponse(
        'El diagnostico es claro.',
        makeTenant(type),
        ''
      );
      expect(result.valid).toBe(false);
    }
  });
});

// ── CAPA 3: Crisis detection ────────────────────────────────

describe('validateResponse — crisis detection', () => {
  const psychTenant = makeTenant('psychologist', 'PsicoMX');
  const medTenant = makeTenant('medical', 'ClinicaMX');
  const retailTenant = makeTenant('retail', 'TiendaMX');

  it('triggers crisis message for "quiero morirme"', () => {
    const result = validateResponse(
      'Entiendo como se siente.',
      psychTenant,
      '',
      'Ya no quiero vivir, quiero morirme'
    );
    expect(result.valid).toBe(true);
    expect(result.text).toContain('Línea de la Vida');
    expect(result.text).toContain('800 911 2000');
    expect(result.text).toContain('SAPTEL');
    expect(result.text).toContain('911');
  });

  it('triggers crisis for "suicidarme"', () => {
    const result = validateResponse(
      'anything',
      psychTenant,
      '',
      'Estoy pensando en suicidarme'
    );
    expect(result.text).toContain('Línea de la Vida');
  });

  it('triggers crisis for "me quiero matar"', () => {
    const result = validateResponse(
      'anything',
      medTenant,
      '',
      'me quiero matar ya no puedo mas'
    );
    expect(result.text).toContain('800 911 2000');
  });

  it('triggers crisis for "me corto" / "me lastimo"', () => {
    const r1 = validateResponse('x', psychTenant, '', 'A veces me corto los brazos');
    expect(r1.text).toContain('SAPTEL');

    const r2 = validateResponse('x', psychTenant, '', 'Me lastimo cuando estoy triste');
    expect(r2.text).toContain('SAPTEL');
  });

  it('triggers crisis for "estarian mejor sin mi"', () => {
    const result = validateResponse(
      'x',
      psychTenant,
      '',
      'Todos estarian mejor sin mi'
    );
    expect(result.text).toContain('Línea de la Vida');
  });

  it('does NOT trigger crisis for non-psychologist/medical tenants', () => {
    const result = validateResponse(
      'Entiendo como se siente.',
      retailTenant,
      '',
      'quiero morirme del calor'
    );
    expect(result.text).not.toContain('Línea de la Vida');
  });

  it('does NOT trigger crisis when customer message is absent', () => {
    const result = validateResponse(
      'Entiendo.',
      psychTenant,
      ''
    );
    expect(result.text).not.toContain('Línea de la Vida');
  });

  it('is case insensitive for crisis keywords', () => {
    const result = validateResponse(
      'x',
      psychTenant,
      '',
      'QUIERO MORIRME'
    );
    expect(result.text).toContain('Línea de la Vida');
  });
});

// ── CAPA 4: Length limits ───────────────────────────────────

describe('validateResponse — length limits', () => {
  const tenant = makeTenant('restaurant');

  it('keeps responses under 600 chars unchanged', () => {
    const msg = 'Hola '.repeat(50); // 250 chars
    const result = validateResponse(msg, tenant, '');
    expect(result.text).toBe(msg);
    expect(result.valid).toBe(true);
  });

  it('truncates responses over 600 chars to 600', () => {
    const msg = 'A'.repeat(700);
    const result = validateResponse(msg, tenant, '');
    expect(result.text.length).toBe(600);
    expect(result.text.endsWith('...')).toBe(true);
  });

  it('truncates exactly at 600 chars', () => {
    const msg = 'B'.repeat(601);
    const result = validateResponse(msg, tenant, '');
    expect(result.text.length).toBe(600);
    expect(result.text).toBe('B'.repeat(597) + '...');
  });

  it('does not truncate exactly 600 char message', () => {
    const msg = 'C'.repeat(600);
    const result = validateResponse(msg, tenant, '');
    expect(result.text.length).toBe(600);
    expect(result.text.endsWith('...')).toBe(false);
  });
});

// ── Layer interaction / priority ────────────────────────────

describe('validateResponse — layer priority', () => {
  it('price check runs before medical check', () => {
    // A medical tenant with a hallucinated price should get price error, not medical error
    const result = validateResponse(
      'El diagnostico cuesta $9999.',
      makeTenant('dental'),
      'Limpieza $500'
    );
    expect(result.valid).toBe(false);
    expect(result.text).toContain('precios exactos');
  });

  it('medical check runs before crisis check', () => {
    // If response contains forbidden medical term AND customer has crisis words,
    // medical guardrail fires first (it checks response text before crisis checks customer input)
    const result = validateResponse(
      'El diagnostico indica depresion severa.',
      makeTenant('psychologist'),
      '',
      'quiero morirme'
    );
    expect(result.valid).toBe(false);
    expect(result.text).toContain('equipo');
  });
});
