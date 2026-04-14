// ─────────────────────────────────────────────────────────────────────────────
// Admin Overview — KPIs de la plataforma completa (Javier-only)
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PLAN_PRICES: Record<string, number> = {
  free_trial: 0,
  trial: 0,
  free: 0,
  basic: 499,
  starter: 499,
  pro: 999,
  professional: 999,
  business: 1999,
  premium: 4999,
  enterprise: 4999,
};

async function loadKPIs() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    { count: activeTenants },
    { count: msgsToday },
    { count: toolCallsToday },
    { count: escalatedConvs },
    { count: totalConvs },
    { data: toolCallsForFallback },
    { data: tenantsForMRR },
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    supabaseAdmin.from('tool_call_logs').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'human_handoff'),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('tool_call_logs').select('fallback_used').gte('created_at', todayStart.toISOString()),
    supabaseAdmin.from('tenants').select('plan').eq('status', 'active'),
  ]);

  const fallbacks = (toolCallsForFallback as Array<{ fallback_used: boolean | null }> | null) || [];
  const fallbackCount = fallbacks.filter((r) => r.fallback_used === true).length;
  const fallbackRate = fallbacks.length > 0 ? Math.round((100 * fallbackCount) / fallbacks.length) : 0;

  const resolutionRate = (totalConvs ?? 0) > 0
    ? Math.round(100 * (1 - (escalatedConvs ?? 0) / (totalConvs ?? 1)))
    : 100;

  const mrr = ((tenantsForMRR as Array<{ plan: string | null }> | null) || []).reduce(
    (sum, t) => sum + (PLAN_PRICES[t.plan ?? 'free'] ?? 0),
    0,
  );

  return {
    activeTenants: activeTenants ?? 0,
    msgsToday: msgsToday ?? 0,
    toolCallsToday: toolCallsToday ?? 0,
    resolutionRate,
    fallbackRate,
    mrr,
  };
}

export default async function AdminOverviewPage() {
  const kpi = await loadKPIs();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Plataforma</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">Overview</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Kpi label="Tenants activos" value={kpi.activeTenants} tone="sky" />
        <Kpi label="Mensajes hoy" value={kpi.msgsToday.toLocaleString('es-MX')} tone="emerald" />
        <Kpi label="Tool calls hoy" value={kpi.toolCallsToday.toLocaleString('es-MX')} tone="violet" />
        <Kpi
          label="Resolución promedio"
          value={`${kpi.resolutionRate}%`}
          tone={kpi.resolutionRate > 85 ? 'emerald' : kpi.resolutionRate > 60 ? 'amber' : 'red'}
        />
        <Kpi
          label="Fallback rate"
          value={`${kpi.fallbackRate}%`}
          tone={kpi.fallbackRate > 15 ? 'red' : kpi.fallbackRate > 5 ? 'amber' : 'emerald'}
        />
        <Kpi label="MRR estimado" value={`$${kpi.mrr.toLocaleString('es-MX')} MXN`} tone="emerald" />
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone: 'sky' | 'emerald' | 'violet' | 'amber' | 'red' }) {
  const toneAccent: Record<string, string> = {
    sky: 'from-sky-400/30 to-transparent',
    emerald: 'from-emerald-400/30 to-transparent',
    violet: 'from-violet-400/30 to-transparent',
    amber: 'from-amber-400/30 to-transparent',
    red: 'from-red-400/30 to-transparent',
  };
  return (
    <div className="stagger-item glass-card relative overflow-hidden p-5">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${toneAccent[tone]}`} />
      <span className="text-[11px] uppercase tracking-wider text-white/50">{label}</span>
      <p className="kpi-number text-3xl font-semibold mt-3 tabular-nums">{value}</p>
    </div>
  );
}
