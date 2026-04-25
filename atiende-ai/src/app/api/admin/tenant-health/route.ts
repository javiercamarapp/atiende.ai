// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/tenant-health?tenant_id=<uuid>
//
// Operational endpoint para que ops/soporte vea la salud de un tenant
// específico sin perderse en logs. Devuelve:
//   - Plan, status, trial_ends_at
//   - Último mensaje inbound/outbound
//   - Citas próximas + activas (last 30d)
//   - Cron failures rate (last 7d) — si cron_runs tiene datos
//   - LLM cost mes actual + último día
//   - Errores tracked último día (errors:* counters)
//
// Auth: Bearer CRON_SECRET (timing-safe via requireCronAuth helper).
// Restringido a ops — no expuesto al dueño del tenant.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id query param required' }, { status: 400 });
  }

  const last24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const last7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const last30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Run all queries in parallel
  const [
    tenantRes,
    lastInboundRes,
    lastOutboundRes,
    recentAptsRes,
    upcomingAptsRes,
    cronRunsRes,
    monthCostRes,
    dayCostRes,
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('id, name, plan, status, business_type, trial_ends_at, created_at').eq('id', tenantId).maybeSingle(),
    supabaseAdmin.from('messages').select('created_at').eq('tenant_id', tenantId).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('messages').select('created_at').eq('tenant_id', tenantId).eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', last30d),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('datetime', new Date().toISOString()).neq('status', 'cancelled'),
    supabaseAdmin.from('cron_runs').select('job_name, tenants_failed, tenants_processed, started_at').gte('started_at', last7d).order('started_at', { ascending: false }).limit(50),
    supabaseAdmin.from('messages').select('cost_usd').eq('tenant_id', tenantId).gte('created_at', monthStart).not('cost_usd', 'is', null),
    supabaseAdmin.from('messages').select('cost_usd').eq('tenant_id', tenantId).gte('created_at', last24h).not('cost_usd', 'is', null),
  ]);

  const tenant = tenantRes.data;
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const monthCost = (monthCostRes.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const dayCost = (dayCostRes.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  // Cron failure rate — % of (jobs that touched any tenant) that have failures
  const cronRuns = cronRunsRes.data ?? [];
  const cronFailureRate = cronRuns.length === 0
    ? null
    : Math.round(
        (cronRuns.filter((r) => (r.tenants_failed ?? 0) > 0).length / cronRuns.length) * 1000,
      ) / 10; // x.x%

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      business_type: tenant.business_type,
      trial_ends_at: tenant.trial_ends_at,
      age_days: Math.floor((Date.now() - new Date(tenant.created_at as string).getTime()) / 86400000),
    },
    activity: {
      last_inbound_at: lastInboundRes.data?.created_at ?? null,
      last_outbound_at: lastOutboundRes.data?.created_at ?? null,
      appointments_30d: recentAptsRes.count ?? 0,
      upcoming_appointments: upcomingAptsRes.count ?? 0,
    },
    cost: {
      llm_usd_this_month: Math.round(monthCost * 10000) / 10000,
      llm_usd_last_24h: Math.round(dayCost * 10000) / 10000,
    },
    ops: {
      cron_runs_7d: cronRuns.length,
      cron_failure_rate_pct: cronFailureRate,
    },
    timestamp: new Date().toISOString(),
  });
}
