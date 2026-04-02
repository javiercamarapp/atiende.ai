import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { calculateKPIs, calculateROI, getAgentPerformance } from '@/lib/analytics/kpi-calculator';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// GET /api/analytics/dashboard?period=7d|30d|90d
export async function GET(request: NextRequest) {
  const log = logger.child({ module: 'api/analytics/dashboard' });

  try {
    // --- Auth ---
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const tenantId = tenant.id;

    // --- Validate query params ---
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      period: searchParams.get('period') || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { period } = parsed.data;
    const days = PERIOD_DAYS[period];
    const to = new Date();
    const from = new Date(Date.now() - days * 86_400_000);

    log.info('Dashboard request', { tenantId, period, from: from.toISOString(), to: to.toISOString() });

    // --- Calculate KPIs, ROI, and agent performance in parallel ---
    const [kpis, roi, agentPerformance] = await Promise.all([
      calculateKPIs(tenantId, from, to),
      calculateROI(tenantId, days),
      getAgentPerformance(tenantId),
    ]);

    return NextResponse.json({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      ...kpis,
      roi,
      agentPerformance,
    });
  } catch (err) {
    log.error('Dashboard API error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
