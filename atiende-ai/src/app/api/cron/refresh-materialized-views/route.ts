// ═════════════════════════════════════════════════════════════════════════════
// CRON — Refresh Materialized Views (Phase 3.D)
//
// Refresca `business_health_current` cada hora llamando a la función SQL
// `refresh_business_health()`. Usa REFRESH CONCURRENTLY para no bloquear
// queries del dashboard.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const { error } = await supabaseAdmin.rpc('refresh_business_health');

  const success = !error;
  await logCronRun({
    jobName: 'refresh-materialized-views',
    startedAt: new Date(start),
    tenantsProcessed: 0,
    tenantsSucceeded: success ? 1 : 0,
    tenantsFailed: success ? 0 : 1,
    details: { error: error?.message, view: 'business_health_current' },
  });

  if (error) {
    return NextResponse.json(
      { error: 'Refresh failed', message: error.message, duration_ms: Date.now() - start },
      { status: 500 },
    );
  }
  return NextResponse.json({ refreshed: 'business_health_current', duration_ms: Date.now() - start });
}
