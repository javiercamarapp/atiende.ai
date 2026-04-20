// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Home — Hero con business_health + revenue_at_risk + churn
// + KPI cards (hoy vs ayer, no-show rate, nuevos pacientes, confirmación)
// + IntelligenceAlerts
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabase } from '@/lib/supabase/server';
import { IntelligenceAlerts } from '@/components/dashboard/intelligence-alerts';
import { AnomalyBanner } from '@/components/dashboard/anomaly-banner';
import { detectAnomalies } from '@/lib/intelligence/anomaly-detector';

function healthTone(score: number): { label: string; dot: string; ring: string; text: string } {
  if (score > 70) return { label: 'Saludable', dot: 'bg-emerald-500', ring: 'ring-emerald-200', text: 'text-emerald-700' };
  if (score >= 40) return { label: 'Atención', dot: 'bg-amber-500', ring: 'ring-amber-200', text: 'text-amber-700' };
  return { label: 'Crítico', dot: 'bg-red-500', ring: 'ring-red-200', text: 'text-red-700' };
}

function fmtMXN(n: number): string {
  return `$${Math.round(n).toLocaleString('es-MX')} MXN`;
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant found</div>;

  // ── Business health desde materialized view (con fallback a 0) ───────────
  const { data: healthRaw } = await supabase
    .from('business_health_current')
    .select('*')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const health = healthRaw as {
    health_score?: number;
    no_show_rate_7d?: number;
    completed_30d?: number;
    patients_at_churn_risk?: number;
    revenue_at_risk_today_mxn?: number;
  } | null;

  const healthScore = Number(health?.health_score ?? 0);
  const revenueAtRisk = Number(health?.revenue_at_risk_today_mxn ?? 0);
  const churnCount = Number(health?.patients_at_churn_risk ?? 0);
  const tone = healthTone(healthScore);

  // ── KPIs: citas hoy vs ayer, no-show rate, nuevos pacientes, confirmación ─
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [aptsTodayR, aptsYestR, noShowWeekR, totalWeekR, newPatientsR, confirmedR, totalMonthR] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('datetime', yesterday.toISOString()).lt('datetime', today.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('status', 'no_show').gte('datetime', weekAgo.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('datetime', weekAgo.toISOString()),
    supabase.from('contacts').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', monthStart.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('datetime', monthStart.toISOString())
      .not('confirmed_at', 'is', null),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('datetime', monthStart.toISOString()),
  ]);

  // Anomalías (best effort — si falla por schema faltante, mostramos lista vacía)
  let anomalies: Awaited<ReturnType<typeof detectAnomalies>> = [];
  try {
    anomalies = await detectAnomalies(tenant.id);
  } catch (err) {
    console.warn('[home] detectAnomalies failed:', err);
  }

  const aptsToday = aptsTodayR.count ?? 0;
  const aptsYest = aptsYestR.count ?? 0;
  const delta = aptsToday - aptsYest;
  const noShowWeek = noShowWeekR.count ?? 0;
  const totalWeek = totalWeekR.count ?? 0;
  const noShowRate = totalWeek > 0 ? Math.round((100 * noShowWeek) / totalWeek) : 0;
  const newPatients = newPatientsR.count ?? 0;
  const confirmed = confirmedR.count ?? 0;
  const totalMonth = totalMonthR.count ?? 0;
  const confirmRate = totalMonth > 0 ? Math.round((100 * confirmed) / totalMonth) : 0;

  return (
    <div className="space-y-8">
      {/* ── Anomaly banners ─────────────────────────────────────────────── */}
      {anomalies.length > 0 && <AnomalyBanner anomalies={anomalies} />}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="animate-element">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Panel</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">
          {tenant.name}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Tu agente está escuchando en WhatsApp 24/7.
        </p>
      </header>

      {/* ── Hero: health + revenue at risk + churn ─────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`stagger-item glass-card p-6 ring-1 ${tone.ring}`}>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Salud del negocio</span>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <p className="kpi-number text-5xl font-semibold tabular-nums">{healthScore}</p>
            <span className={`mb-2 text-xs font-medium ${tone.text}`}>{tone.label}</span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">Score compuesto 0-100 por recencia, asistencia y cancelaciones.</p>
        </div>

        <div className="stagger-item glass-card p-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Ingresos en riesgo hoy</span>
          </div>
          <p className="kpi-number text-5xl font-semibold mt-3 tabular-nums">{fmtMXN(revenueAtRisk)}</p>
          <p className="mt-2 text-xs text-zinc-500">Estimación por citas con alta probabilidad de no-show.</p>
        </div>

        <div className="stagger-item glass-card p-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Pacientes en riesgo de churn</span>
          </div>
          <p className="kpi-number text-5xl font-semibold mt-3 tabular-nums">{churnCount}</p>
          <p className="mt-2 text-xs text-zinc-500">Con probabilidad de churn mayor al 60%.</p>
        </div>
      </section>

      {/* ── KPI cards 2x2 ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Citas hoy"
          value={aptsToday}
          delta={delta}
          subtitle={`${aptsYest} ayer`}
          tone="sky"
        />
        <KpiCard
          label="No-show rate (7d)"
          value={`${noShowRate}%`}
          subtitle={`${noShowWeek} de ${totalWeek} citas`}
          tone={noShowRate > 20 ? 'red' : noShowRate > 10 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Pacientes nuevos (mes)"
          value={newPatients}
          tone="violet"
        />
        <KpiCard
          label="Confirmación (mes)"
          value={`${confirmRate}%`}
          subtitle={`${confirmed} de ${totalMonth} citas`}
          tone={confirmRate > 70 ? 'emerald' : confirmRate > 40 ? 'amber' : 'red'}
        />
      </section>

      {/* ── Intelligence Alerts ────────────────────────────────────────── */}
      <div className="animate-element animate-delay-200">
        <IntelligenceAlerts tenantId={tenant.id} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, delta, subtitle, tone,
}: {
  label: string;
  value: string | number;
  delta?: number;
  subtitle?: string;
  tone: 'emerald' | 'amber' | 'red' | 'sky' | 'violet';
}) {
  const toneColor: Record<string, string> = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    sky: 'text-sky-700',
    violet: 'text-violet-700',
  };
  const toneAccent: Record<string, string> = {
    emerald: 'from-emerald-500/50 to-transparent',
    amber: 'from-amber-500/50 to-transparent',
    red: 'from-red-500/50 to-transparent',
    sky: 'from-sky-500/50 to-transparent',
    violet: 'from-violet-500/50 to-transparent',
  };

  return (
    <div className="stagger-item glass-card relative overflow-hidden p-5">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${toneAccent[tone]}`} />
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="kpi-number text-3xl font-semibold tabular-nums">{value}</p>
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {subtitle && <p className={`mt-1 text-xs ${toneColor[tone]} opacity-80`}>{subtitle}</p>}
    </div>
  );
}
