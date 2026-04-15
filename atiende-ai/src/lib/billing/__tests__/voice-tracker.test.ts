import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ANTES de importar
vi.mock('@/lib/supabase/admin', () => {
  const insert = vi.fn();
  const update = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn();
  const single = vi.fn();
  const select = vi.fn();
  const rpc = vi.fn();
  return {
    supabaseAdmin: {
      from: vi.fn(() => ({
        insert: insert.mockResolvedValue({ error: null }),
        update: update.mockReturnThis(),
        select: select.mockReturnThis(),
        eq: eq.mockReturnThis(),
        maybeSingle: maybeSingle.mockResolvedValue({ data: null }),
        single: single.mockResolvedValue({ data: { plan: 'premium', voice_minutes_included: 300 } }),
      })),
      rpc: rpc.mockResolvedValue({ data: [{ minutes_used: 5, overage_minutes: 0 }], error: null }),
    },
  };
});

vi.mock('@/lib/config', () => ({
  VOICE_MINUTES_INCLUDED_PREMIUM: 300,
}));

import { trackVoiceCall } from '../voice-tracker';
import { supabaseAdmin } from '@/lib/supabase/admin';

describe('trackVoiceCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('descarta llamadas <5s (ring accidental)', async () => {
    const result = await trackVoiceCall('tenant-1', 'call-1', 3);
    expect(result.minutesUsed).toBe(0);
    expect(result.included).toBe(300);
    expect(result.overage).toBe(0);
    expect(result.isOverage).toBe(false);
  });

  it('redondea duración al minuto superior (Math.ceil)', async () => {
    // 61 segundos = 2 minutos (telco standard ceil)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{ minutes_used: 2, overage_minutes: 0 }],
      error: null,
    } as never);

    const r = await trackVoiceCall('tenant-1', 'call-61s', 61);
    // La tool pasa p_minutes=2 (Math.ceil(61/60))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'increment_voice_minutes',
      expect.objectContaining({ p_minutes: 2, p_included: 300 }),
    );
    expect(r.minutesUsed).toBe(2);
  });

  it('detecta overage cuando el tenant excede minutos incluidos', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{ minutes_used: 310, overage_minutes: 10 }],
      error: null,
    } as never);

    const r = await trackVoiceCall('tenant-1', 'call-overage', 120);
    expect(r.isOverage).toBe(true);
    expect(r.overage).toBe(10);
    expect(r.percentUsed).toBeGreaterThanOrEqual(100);
  });

  it('fail-safe: NO throw si RPC falla', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'DB down', code: 'PGRST000' },
    } as never);

    const r = await trackVoiceCall('tenant-1', 'call-rpc-fail', 60);
    // Debe retornar un objeto válido con cálculo local
    expect(r).toBeDefined();
    expect(r.minutesUsed).toBe(1);
  });
});
