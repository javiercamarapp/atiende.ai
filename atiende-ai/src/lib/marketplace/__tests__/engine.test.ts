// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock agent handlers ─────────────────────────────────────

vi.mock('../agents/marketing', () => ({
  runResenas: vi.fn(),
  runReactivacion: vi.fn(),
  runCumpleanos: vi.fn(),
  runReferidos: vi.fn(),
  runRedesSociales: vi.fn(),
  runHappyHour: vi.fn(),
  runRespuestaResenas: vi.fn(),
}));

vi.mock('../agents/operations', () => ({
  runCobrador: vi.fn(),
  runSeguimiento: vi.fn(),
  runOptimizador: vi.fn(),
  runBilingue: vi.fn(),
  runInventario: vi.fn(),
  runConfirmacionCita: vi.fn(),
  runListaEspera: vi.fn(),
  runMenuCatalogo: vi.fn(),
  runDirecciones: vi.fn(),
  runHorarioFuera: vi.fn(),
}));

vi.mock('../agents/analytics', () => ({
  runNPS: vi.fn(),
  runReportes: vi.fn(),
  runFAQBuilder: vi.fn(),
  runRendimientoStaff: vi.fn(),
}));

vi.mock('../agents/sales', () => ({
  runCalificador: vi.fn(),
  runUpselling: vi.fn(),
  runNurturing: vi.fn(),
  runLinkPago: vi.fn(),
}));

// ── Mock supabase ───────────────────────────────────────────

const mockUpdate = vi.fn(() => ({ eq: vi.fn() }));
const mockSelectChain = {
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
};

const mockFrom = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  update: mockUpdate,
  data: null,
}));

let mockActiveAgents: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'tenant_agents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ data: mockActiveAgents })),
          })),
          update: mockUpdate,
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    },
  },
}));

import { executeCronAgents, executeEventAgents } from '../engine';
import { runResenas, runCumpleanos } from '../agents/marketing';
import { runCobrador } from '../agents/operations';
import { runNPS } from '../agents/analytics';
import { runCalificador } from '../agents/sales';

// ── Helpers ─────────────────────────────────────────────────

function makeTenantAgent(slug: string, triggerType: string, triggerConfig: Record<string, string>, opts: Record<string, unknown> = {}) {
  return {
    id: `ta-${slug}`,
    tenant_id: 'tenant-1',
    config: {},
    run_count: opts.run_count ?? 0,
    is_active: true,
    agent: {
      slug,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      prompt_template: 'test prompt',
    },
    tenant: {
      id: 'tenant-1',
      name: 'Test Biz',
      wa_phone_number_id: 'phone-1',
      business_type: 'dental',
    },
    ...opts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveAgents = [];
});

// ── CRON Tests ──────────────────────────────────────────────

describe('executeCronAgents', () => {
  it('runs agents matching schedule', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }),
    ];
    const result = await executeCronAgents('daily_9am');
    expect(result.executed).toBe(1);
    expect(runResenas).toHaveBeenCalled();
  });

  it('returns 0 when no agents match schedule', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'weekly_monday' }),
    ];
    const result = await executeCronAgents('daily_9am');
    expect(result.executed).toBe(0);
  });

  it('returns 0 when no active agents exist', async () => {
    mockActiveAgents = [];
    const result = await executeCronAgents('daily_9am');
    expect(result.executed).toBe(0);
  });

  it('skips event-triggered agents', async () => {
    mockActiveAgents = [
      makeTenantAgent('calificador', 'event', { event: 'new_message' }),
    ];
    const result = await executeCronAgents('daily_9am');
    expect(result.executed).toBe(0);
    expect(runCalificador).not.toHaveBeenCalled();
  });

  it('runs multiple matching agents', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }),
      makeTenantAgent('cumpleanos', 'cron', { schedule: 'daily_9am' }),
      makeTenantAgent('cobrador', 'cron', { schedule: 'weekly_monday' }),
    ];
    const result = await executeCronAgents('daily_9am');
    expect(result.executed).toBe(2);
    expect(runResenas).toHaveBeenCalled();
    expect(runCumpleanos).toHaveBeenCalled();
    expect(runCobrador).not.toHaveBeenCalled();
  });

  it('updates last_run_at after successful execution', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }),
    ];
    await executeCronAgents('daily_9am');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        last_run_at: expect.any(String),
        run_count: 1,
      })
    );
  });

  it('increments run_count correctly', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }, { run_count: 5 }),
    ];
    await executeCronAgents('daily_9am');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ run_count: 6 })
    );
  });

  it('continues running other agents when one fails', async () => {
    (runResenas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }),
      makeTenantAgent('nps', 'cron', { schedule: 'daily_9am' }),
    ];
    const result = await executeCronAgents('daily_9am');
    // resenas fails, nps succeeds
    expect(result.executed).toBe(1);
    expect(runNPS).toHaveBeenCalled();
  });
});

// ── EVENT Tests ─────────────────────────────────────────────

describe('executeEventAgents', () => {
  it('runs agents matching event name', async () => {
    mockActiveAgents = [
      makeTenantAgent('calificador', 'event', { event: 'new_lead' }),
    ];
    const result = await executeEventAgents('new_lead', { phone: '123' });
    expect(result.executed).toBe(1);
    expect(runCalificador).toHaveBeenCalled();
  });

  it('returns 0 when no active agents', async () => {
    mockActiveAgents = [];
    const result = await executeEventAgents('new_lead', {});
    expect(result.executed).toBe(0);
  });

  it('returns 0 when no agents match event', async () => {
    mockActiveAgents = [
      makeTenantAgent('calificador', 'event', { event: 'appointment_booked' }),
    ];
    const result = await executeEventAgents('new_lead', {});
    expect(result.executed).toBe(0);
  });

  it('skips cron-triggered agents', async () => {
    mockActiveAgents = [
      makeTenantAgent('resenas', 'cron', { schedule: 'daily_9am' }),
    ];
    const result = await executeEventAgents('new_lead', {});
    expect(result.executed).toBe(0);
  });

  it('passes event payload in agent config', async () => {
    mockActiveAgents = [
      makeTenantAgent('calificador', 'event', { event: 'new_lead' }),
    ];
    await executeEventAgents('new_lead', { phone: '5219991234567' });
    expect(runCalificador).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ eventPayload: { phone: '5219991234567' } }),
      })
    );
  });

  it('logs error and continues when agent fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (runCalificador as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
    mockActiveAgents = [
      makeTenantAgent('calificador', 'event', { event: 'new_lead' }),
    ];
    const result = await executeEventAgents('new_lead', {});
    expect(result.executed).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
