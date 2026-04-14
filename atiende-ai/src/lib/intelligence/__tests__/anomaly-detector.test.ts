import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabaseAdmin antes de importar el módulo bajo test
const selectChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
  then: vi.fn(),
};

// Default: empty resolves
function makeEmpty() {
  const chain = {
    ...selectChain,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  // Hacer thenable → resuelve con { data: [], count: 0 }
  return Object.assign(chain, {
    then: (resolve: (v: { data: unknown[]; count: number }) => void) =>
      resolve({ data: [], count: 0 }),
  });
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeEmpty()),
  },
}));

import { detectAnomalies } from '../anomaly-detector';

describe('detectAnomalies()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna [] si no hay datos históricos', async () => {
    const result = await detectAnomalies('00000000-0000-0000-0000-000000000001');
    expect(result).toEqual([]);
  });

  it('no crashea con tenantId UUID válido aún sin data', async () => {
    await expect(
      detectAnomalies('fab31042-fba2-4321-8b15-814a4cdff931'),
    ).resolves.toBeDefined();
  });

  it('cada anomaly tiene shape esperado', async () => {
    const result = await detectAnomalies('00000000-0000-0000-0000-000000000002');
    for (const a of result) {
      expect(a).toHaveProperty('metric');
      expect(a).toHaveProperty('current_value');
      expect(a).toHaveProperty('expected_value');
      expect(a).toHaveProperty('deviation_pct');
      expect(['positive', 'negative']).toContain(a.type);
      expect(['info', 'warning', 'critical']).toContain(a.severity);
      expect(a.message).toBeTypeOf('string');
    }
  });
});
