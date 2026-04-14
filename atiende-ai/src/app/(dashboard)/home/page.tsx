// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Home — Hero con business_health + revenue_at_risk + churn
// + KPI cards (hoy vs ayer, no-show rate, nuevos pacientes, confirmación)
// + IntelligenceAlerts
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabase } from '@/lib/supabase/server';
import { IntelligenceAlerts } from '@/components/dashboard/intelligence-alerts';

function healthTone(score: number): { label: string; dot: string; ring: string; text: string } {
  if (score > 70) return { label: 'Saludable', dot: 'bg-emerald-400', ring: 'ring-emerald-400/30', text: 'text-emerald-300' };
  if (score >= 40) return { label: 'Atención', dot: 'bg-amber-400', ring: 'ring-amber-400/30', text: 'text-amber-300' };
  return { label: 'Crítico', dot: 'bg-red-400', ring: 'ring-red-400/30', text: 'text-red-300' };
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
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="animate-element">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Panel</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">
          {tenant.name}
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          Tu agente está escuchando en WhatsApp 24/7.
        </p>
      </header>

      {/* ── Hero: health + revenue at risk + churn ─────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`stagger-item glass-card p-6 ring-1 ${tone.ring}`}>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
            <span className="text-[11px] uppercase tracking-wider text-white/50">Salud del negocio</span>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <p className="kpi-number text-5xl font-semibold tabular-nums">{healthScore}</p>
            <span className={`mb-2 text-xs font-medium ${tone.text}`}>{tone.label}</span>
          </div>
          <p className="mt-2 text-xs text-white/45">Score compuesto 0-100 por recencia, asistencia y cancelaciones.</p>
        </div>

        <div className="stagger-item glass-card p-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[11px] uppercase tracking-wider text-white/50">Ingresos en riesgo hoy</span>
          </div>
          <p className="kpi-number text-5xl font-semibold mt-3 tabular-nums">{fmtMXN(revenueAtRisk)}</p>
          <p className="mt-2 text-xs text-white/45">Estimación por citas con alta probabilidad de no-show.</p>
        </div>

        <div className="stagger-item glass-card p-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[11px] uppercase tracking-wider text-white/50">Pacientes en riesgo de churn</span>
          </div>
          <p className="kpi-number text-5xl font-semibold mt-3 tabular-nums">{churnCount}</p>
          <p className="mt-2 text-xs text-white/45">Con probabilidad de churn mayor al 60%.</p>
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
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    red: 'text-red-300',
    sky: 'text-sky-300',
    violet: 'text-violet-300',
  };
  const toneAccent: Record<string, string> = {
    emerald: 'from-emerald-400/30 to-transparent',
    amber: 'from-amber-400/30 to-transparent',
    red: 'from-red-400/30 to-transparent',
    sky: 'from-sky-400/30 to-transparent',
    violet: 'from-violet-400/30 to-transparent',
  };

  return (
    <div className="stagger-item glass-card relative overflow-hidden p-5">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${toneAccent[tone]}`} />
      <span className="text-[11px] uppercase tracking-wider text-white/50">{label}</span>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="kpi-number text-3xl font-semibold tabular-nums">{value}</p>
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {subtitle && <p className={`mt-1 text-xs ${toneColor[tone]} opacity-70`}>{subtitle}</p>}
    </div>
  );
}
