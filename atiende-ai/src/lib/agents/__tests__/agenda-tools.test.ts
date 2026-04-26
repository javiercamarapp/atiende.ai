import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks ANTES de importar el módulo bajo test
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: vi.fn().mockResolvedValue(undefined),
  sendTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/actions/notifications', () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/marketplace/engine', () => ({
  executeEventAgents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/calendar/google', () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({ eventId: 'gcal-1' }),
  cancelCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/intelligence/conversation-analysis', () => ({
  classifyCancellationReason: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/actions/appointment-helpers', () => ({
  hasConflict: vi.fn(),
  buildLocalIso: vi.fn((date: string, time: string) => `${date}T${time}:00-06:00`),
  isWithinBusinessHours: vi.fn().mockReturnValue(true),
  findMatchingStaff: vi.fn(),
  findMatchingService: vi.fn(),
  formatDateTimeMx: vi.fn().mockReturnValue({
    dateFmt: 'lunes 20 de abril',
    timeFmt: '10:00',
  }),
  dayKeyForDatetime: vi.fn().mockReturnValue('lun'),
  timeOfDayInTimezone: vi.fn().mockReturnValue('10:00'),
}));

import '@/lib/agents/agenda'; // side-effect: registra las tools
import { executeTool } from '@/lib/llm/tool-executor';
import { supabaseAdmin } from '@/lib/supabase/admin';
import * as helpers from '@/lib/actions/appointment-helpers';

const mockCtx = {
  tenantId: 'tenant-123',
  contactId: 'contact-123',
  conversationId: 'conv-123',
  customerPhone: '5219991234567',
  tenant: {
    id: 'tenant-123',
    name: 'Consultorio Test',
    timezone: 'America/Merida',
    business_hours: {
      lun: '09:00-18:00',
      mar: '09:00-18:00',
      mie: '09:00-18:00',
      jue: '09:00-18:00',
      vie: '09:00-18:00',
    },
  },
};

// AUDIT R20: fechas calculadas dinámicamente para que los tests no se
// pudran con el paso del tiempo. Buscamos el próximo domingo (día cerrado)
// y el próximo lunes (día abierto) relativos a la fecha actual.
function nextWeekday(dow: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // noon UTC para evitar edge cases de TZ
  const diff = (dow - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
const FUTURE_SUNDAY = nextWeekday(0); // día cerrado
const FUTURE_MONDAY = nextWeekday(1); // día abierto

/** Helper para crear un mock chainable de Supabase query builder. */
function makeQuery(finalData: unknown, count?: number) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: finalData, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: finalData, error: null }),
    then: (resolve: (v: { data: unknown; error: null; count?: number }) => void) =>
      resolve({ data: finalData, error: null, count }),
  };
  return chain;
}

describe('check_availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('día cerrado (sin business_hours para ese día) → CLOSED', async () => {
    // Mock chainable: tenant_holidays retorna null (no es festivo), staff vacío
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string): never => {
      if (table === 'tenant_holidays') {
        const noHolidayChain = makeQuery(null);
        noHolidayChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        return noHolidayChain as never;
      }
      return makeQuery([]) as never;
    });

    // Día sin business_hours configurado (por ejemplo "sab" o "dom")
    const result = await executeTool(
      'check_availability',
      { date: FUTURE_SUNDAY, service_type: 'limpieza' }, // domingo
      { ...mockCtx, tenant: { ...mockCtx.tenant, business_hours: mockCtx.tenant.business_hours } } as never,
    );

    expect(result.success).toBe(true); // executeTool wraps result
    const inner = result.result as { available: boolean; reason: string };
    expect(inner.available).toBe(false);
    expect(inner.reason).toBe('CLOSED');
  });

  it('día abierto sin citas → retorna slots disponibles', async () => {
    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string): never => {
      callCount++;
      if (table === 'tenant_holidays') {
        const noHolidayChain = makeQuery(null);
        noHolidayChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        return noHolidayChain as never;
      }
      if (table === 'staff') {
        return makeQuery([
          { id: 'staff-1', name: 'Dr. Test', default_duration: 30 },
        ]) as never;
      }
      if (table === 'appointments') {
        return makeQuery([]) as never; // sin citas existentes
      }
      return makeQuery([]) as never;
    });

    const result = await executeTool(
      'check_availability',
      { date: FUTURE_MONDAY, service_type: 'limpieza', duration_minutes: 30 }, // lunes
      mockCtx as never,
    );

    expect(result.success).toBe(true);
    const inner = result.result as { available: boolean; slots?: unknown[] };
    expect(inner.available).toBe(true);
    expect(Array.isArray(inner.slots)).toBe(true);
    expect((inner.slots as unknown[]).length).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThan(0);
  });
});

describe('book_appointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.findMatchingStaff).mockReturnValue({
      id: 'staff-1',
      name: 'Dr. Test',
      google_calendar_id: null,
      default_duration: 30,
    } as never);
    vi.mocked(helpers.findMatchingService).mockReturnValue({
      id: 'svc-1',
      name: 'Limpieza dental',
      price: 800,
      duration_minutes: 30,
    } as never);
  });

  it('con conflicto → SLOT_TAKEN', async () => {
    vi.mocked(helpers.hasConflict).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.from).mockImplementation(
      (): never => makeQuery([{ id: 'staff-1', name: 'Dr. Test', default_duration: 30 }]) as never,
    );

    const result = await executeTool(
      'book_appointment',
      {
        date: FUTURE_MONDAY,
        time: '10:00',
        service_type: 'limpieza',
        patient_name: 'María García',
        patient_phone: '9991234567',
      },
      mockCtx as never,
    );

    expect(result.success).toBe(true);
    const inner = result.result as { success: boolean; error_code?: string };
    expect(inner.success).toBe(false);
    expect(inner.error_code).toBe('SLOT_TAKEN');
  });

  it('exitoso → success: true + confirmation_code', async () => {
    vi.mocked(helpers.hasConflict).mockResolvedValue(false);

    let appointmentInsert = false;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string): never => {
      if (table === 'staff') {
        return makeQuery([
          { id: 'staff-1', name: 'Dr. Test', google_calendar_id: null, default_duration: 30 },
        ]) as never;
      }
      if (table === 'services') {
        return makeQuery([
          { id: 'svc-1', name: 'Limpieza dental', duration_minutes: 30, price: 800 },
        ]) as never;
      }
      if (table === 'appointments') {
        appointmentInsert = true;
        return makeQuery({ id: 'appt-1' }) as never;
      }
      return makeQuery(null) as never;
    });

    const result = await executeTool(
      'book_appointment',
      {
        date: FUTURE_MONDAY,
        time: '10:00',
        service_type: 'limpieza',
        patient_name: 'María García',
        patient_phone: '9991234567',
      },
      mockCtx as never,
    );

    expect(result.success).toBe(true);
    const inner = result.result as {
      success: boolean;
      appointment?: { confirmation_code: string };
    };
    expect(inner.success).toBe(true);
    // Confirmation code post entropy upgrade: 16 chars, base32 Crockford
    // alphabet (sin I/L/O/U). Antes era 8 hex chars (32 bits entropy =
    // brute-forceable). Ahora 80 bits efectivos.
    expect(inner.appointment?.confirmation_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(appointmentInsert).toBe(true);
  });
});

describe('cancel_appointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('phone que no coincide con el dueño de la cita → NOT_FOUND', async () => {
    // El SELECT está scoped por (id, tenant_id, customer_phone) — si phone no
    // coincide, retorna NULL/error. El handler debe responder error_code NOT_FOUND.
    // Mock chainable: makeQuery devuelve {data:null, error} en .single()
    const notFoundChain = makeQuery(null);
    notFoundChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found', code: 'PGRST116' },
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(notFoundChain as never);

    const result = await executeTool(
      'cancel_appointment',
      {
        appointment_id: '7f3b9e2c-4a1d-4f8b-9c2a-1e5d3f7a8b9c',
        patient_phone: '5219990000000', // diferente al de la cita real
      },
      mockCtx as never,
    );

    expect(result.success).toBe(true);
    const inner = result.result as { success: boolean; error_code?: string };
    expect(inner.success).toBe(false);
    expect(inner.error_code).toBe('NOT_FOUND');
  });
});
