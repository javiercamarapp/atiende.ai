import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks MUST be declared before the import of the route under test.
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  vertical: 'dental',
  businessName: 'Clínica Sonrisas',
  answers: {
    q1: 'Clínica Sonrisas',
    q2: 'Calle 10 #123, Mérida',
    q3: 'L-V 9-19',
    q5: 'Dr. García',
  },
};

function mockTenantsLookup(existing: { id: string } | null) {
  const eqChain = {
    maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
  };
  const selectChain = { eq: vi.fn().mockReturnValue(eqChain) };
  return {
    select: vi.fn().mockReturnValue(selectChain),
  };
}

function mockTenantsInsert(row: { id: string } | null, error: Error | null = null) {
  const singleFn = vi.fn().mockResolvedValue({ data: row, error });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  return {
    insert: vi.fn().mockReturnValue({ select: selectFn }),
  };
}

function mockTenantsUpdate(error: Error | null = null) {
  const eqFn = vi.fn().mockResolvedValue({ error });
  return {
    update: vi.fn().mockReturnValue({ eq: eqFn }),
  };
}

function mockOnboardingResponses() {
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
  const insertFn = vi.fn().mockResolvedValue({ error: null });
  return {
    delete: deleteFn,
    insert: insertFn,
  };
}

describe('POST /api/onboarding/generate', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });
    const res = await POST(
      makeRequest({ vertical: 'not_a_vertical', answers: {}, businessName: '' }),
    );
    expect(res.status).toBe(400);
  });

  it('inserts new tenant + onboarding responses on first run', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'owner@clinica.com' } },
      error: null,
    });

    const tenantsMock = {
      ...mockTenantsLookup(null),
      ...mockTenantsInsert({ id: 't-new-123' }),
    };
    const onboardingMock = mockOnboardingResponses();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsMock;
      if (table === 'onboarding_responses') return onboardingMock;
      throw new Error(`unexpected table: ${table}`);
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.tenantId).toBe('t-new-123');

    // Verify insert payload
    expect(tenantsMock.insert).toHaveBeenCalledTimes(1);
    const insertArg = (tenantsMock.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.user_id).toBe('u-1');
    expect(insertArg.name).toBe('Clínica Sonrisas');
    expect(insertArg.business_type).toBe('dental');
    expect(insertArg.email).toBe('owner@clinica.com');
    expect(insertArg.status).toBe('active');
    expect(insertArg.chat_system_prompt).toContain('Clínica Sonrisas');
    expect(insertArg.config.vertical).toBe('dental');
    expect(insertArg.config.answersRaw.q1).toBe('Clínica Sonrisas');

    // Audit trail: one row per non-empty answer
    expect(onboardingMock.delete).toHaveBeenCalledTimes(1);
    expect(onboardingMock.insert).toHaveBeenCalledTimes(1);
    const auditRows = (onboardingMock.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditRows).toHaveLength(4);
    expect(auditRows[0]).toMatchObject({
      tenant_id: 't-new-123',
      step: 1,
      question_key: 'q1',
      answer: { value: 'Clínica Sonrisas' },
    });
  });

  it('updates existing tenant when one already exists for the user', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });

    const tenantsMock = {
      ...mockTenantsLookup({ id: 't-existing-456' }),
      ...mockTenantsUpdate(null),
    };
    const onboardingMock = mockOnboardingResponses();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsMock;
      if (table === 'onboarding_responses') return onboardingMock;
      throw new Error(`unexpected table: ${table}`);
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tenantId).toBe('t-existing-456');
    expect(tenantsMock.update).toHaveBeenCalledTimes(1);
  });

  it('maps non-dental verticals through verticalToBusinessType', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });
    const tenantsMock = {
      ...mockTenantsLookup(null),
      ...mockTenantsInsert({ id: 't-1' }),
    };
    mockFrom.mockImplementation((table: string) =>
      table === 'tenants' ? tenantsMock : mockOnboardingResponses(),
    );

    await POST(
      makeRequest({
        vertical: 'panaderia',
        businessName: 'La Esquina',
        answers: { q1: 'La Esquina' },
      }),
    );
    const insertArg = (tenantsMock.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // panaderia maps to 'cafe' in the DB enum
    expect(insertArg.business_type).toBe('cafe');
    // But the fine-grained vertical is preserved in config
    expect(insertArg.config.vertical).toBe('panaderia');
  });

  it('returns 500 when tenant insert fails', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });
    const tenantsMock = {
      ...mockTenantsLookup(null),
      ...mockTenantsInsert(null, new Error('db down')),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsMock;
      return mockOnboardingResponses();
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to create');
  });

  it('still returns 200 if audit trail insert fails (non-fatal)', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });
    const tenantsMock = {
      ...mockTenantsLookup(null),
      ...mockTenantsInsert({ id: 't-1' }),
    };
    const onboardingMock = {
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      insert: vi.fn().mockResolvedValue({ error: new Error('audit failed') }),
    };
    mockFrom.mockImplementation((table: string) =>
      table === 'tenants' ? tenantsMock : onboardingMock,
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
  });

  it('skips empty or whitespace-only answers in audit trail', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@b.com' } },
      error: null,
    });
    const tenantsMock = {
      ...mockTenantsLookup(null),
      ...mockTenantsInsert({ id: 't-1' }),
    };
    const onboardingMock = mockOnboardingResponses();
    mockFrom.mockImplementation((table: string) =>
      table === 'tenants' ? tenantsMock : onboardingMock,
    );

    await POST(
      makeRequest({
        vertical: 'dental',
        businessName: 'X',
        answers: {
          q1: 'Real',
          q2: '   ',
          q3: '',
        },
      }),
    );
    const auditRows = (onboardingMock.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].question_key).toBe('q1');
  });
});
