// ═════════════════════════════════════════════════════════════════════════════
// CRON — Daily analytics rollup
//
// Audit fix: antes hacía 11 queries serial por tenant (5 messages, 3
// appointments, 2 orders, 1 conversations + costos). Con 1k tenants se
// acercaba al timeout 300s. Ahora delegamos a Postgres function que hace
// todo en 1 sola query con CTEs paralelas (~10x más rápido + libera Vercel).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const authFail = requireCronAuth(req);
    if (authFail) return authFail;

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('status', 'active');

    let processed = 0;
    let failed = 0;

    for (const t of tenants || []) {
      try {
        const { error } = await supabaseAdmin.rpc('compute_daily_analytics_for_tenant', {
          p_tenant_id: t.id as string,
          p_date: yesterday,
        });
        if (error) throw error;
        processed++;
      } catch (err) {
        console.error('[cron/analytics] tenant failed:', t.id, err);
        failed++;
      }
    }

    return NextResponse.json({ processed, failed, date: yesterday });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
