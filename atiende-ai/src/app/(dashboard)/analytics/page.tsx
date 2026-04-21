import { createServerSupabase } from '@/lib/supabase/server';
import {
  TrendingUp, TrendingDown, Users, MessageSquare, DollarSign, Clock,
  AlertCircle, CheckCircle2,
} from 'lucide-react';
import { AnalyticsCharts } from '@/components/dashboard/analytics-charts';

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const REASON_LABELS: Record<string, string> = {
  economica: 'Económica',
  tiempo: 'Falta de tiempo',
  olvido: 'Olvido',
  malestar: 'Malestar / enfermedad',
  insatisfaccion: 'Insatisfacción',
  emergencia: 'Emergencia',
  sin_razon: 'Sin razón clara',
};

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id, name').eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant found</div>;

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const ago90 = new Date(nowMs - 90 * 86_400_000).toISOString();
  const ago30 = new Date(nowMs - 30 * 86_400_000).toISOString();
  const ago60to30 = new Date(nowMs - 60 * 86_400_000).toISOString();

  // ── KPI top cards ────────────────────────────────────────────────────────
  const [
    aptsNow, aptsPrev,
    msgsNow, msgsPrev,
    contactsNow, contactsPrev,
    revNow,
  ] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago30),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago60to30).lt('created_at', ago30),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago30),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago60to30).lt('created_at', ago30),
    supabase.from('contacts').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago30),
    supabase.from('contacts').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', ago60to30).lt('created_at', ago30),
    supabase.from('appointments').select('price_mxn')
      .eq('tenant_id', tenant.id).in('status', ['completed', 'scheduled']).gte('created_at', ago30),
  ]);

  const revenueNow = ((revNow.data as Array<{ price_mxn: number | null }> | null) || [])
    .reduce((s, r) => s + (Number(r.price_mxn) || 0), 0);

  const pctChange = (now: number, prev: number): number => {
    if (prev === 0) return now > 0 ? 100 : 0;
    return Math.round(((now - prev) / prev) * 100);
  };

  const kpis = [
    {
      label: 'Citas (30d)',
      value: aptsNow.count ?? 0,
      delta: pctChange(aptsNow.count ?? 0, aptsPrev.count ?? 0),
      icon: CheckCircle2,
      tint: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
    },
    {
      label: 'Mensajes',
      value: msgsNow.count ?? 0,
      delta: pctChange(msgsNow.count ?? 0, msgsPrev.count ?? 0),
      icon: MessageSquare,
      tint: 'bg-violet-50 text-violet-600',
    },
    {
      label: 'Nuevos contactos',
      value: contactsNow.count ?? 0,
      delta: pctChange(contactsNow.count ?? 0, contactsPrev.count ?? 0),
      icon: Users,
      tint: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Revenue',
      value: `$${revenueNow.toLocaleString('es-MX')}`,
      delta: null as number | null,
      icon: DollarSign,
      tint: 'bg-amber-50 text-amber-600',
    },
  ];

  // ── Daily trend (last 30d messages/appts) ────────────────────────────────
  const { data: daily } = await supabase
    .from('tenant_daily_metrics')
    .select('date, messages_inbound, appointments_booked, orders_revenue')
    .eq('tenant_id', tenant.id)
    .gte('date', ago30.split('T')[0])
    .order('date');

  const trend = ((daily as Array<{ date: string; messages_inbound: number; appointments_booked: number; orders_revenue: number }> | null) || [])
    .map(d => ({
      date: new Date(d.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      mensajes: d.messages_inbound ?? 0,
      citas: d.appointments_booked ?? 0,
      revenue: d.orders_revenue ?? 0,
    }));

  // ── 1. No-show by DOW ────────────────────────────────────────────────────
  const { data: noShows } = await supabase
    .from('appointments')
    .select('datetime')
    .eq('tenant_id', tenant.id).eq('status', 'no_show').gte('datetime', ago90);
  const noShowByDow = new Array(7).fill(0);
  for (const a of (noShows as Array<{ datetime: string }> | null) || []) {
    noShowByDow[new Date(a.datetime).getDay()]++;
  }

  // ── 2. Reasons ───────────────────────────────────────────────────────────
  const { data: cancelled } = await supabase
    .from('appointments').select('cancellation_reason')
    .eq('tenant_id', tenant.id).eq('status', 'cancelled')
    .not('cancellation_reason', 'is', null).gte('datetime', ago90);
  const reasonCounts = new Map<string, number>();
  for (const c of (cancelled as Array<{ cancellation_reason: string }> | null) || []) {
    const r = c.cancellation_reason || 'sin_razon';
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }
  const reasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => ({ label: REASON_LABELS[key] ?? key, count }));
  const reasonsTotal = reasons.reduce((s, r) => s + r.count, 0) || 1;

  // ── 3. Revenue at risk last 4 weeks ──────────────────────────────────────
  const weeks = 4;
  const weekPoints: Array<{ label: string; value: number }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(nowMs - (w + 1) * 7 * 86_400_000);
    const weekEnd = new Date(nowMs - w * 7 * 86_400_000);
    const { data: weekApts } = await supabase
      .from('appointments').select('price_mxn')
      .eq('tenant_id', tenant.id).in('status', ['no_show', 'cancelled'])
      .gte('datetime', weekStart.toISOString()).lt('datetime', weekEnd.toISOString());
    const totalLost = ((weekApts as Array<{ price_mxn: number | null }> | null) || [])
      .reduce((s, a) => s + (Number(a.price_mxn) || 500), 0);
    weekPoints.push({ label: w === 0 ? 'Esta' : `S-${w}`, value: totalLost });
  }

  // ── 4. Reactivados ───────────────────────────────────────────────────────
  const { count: reactivatedCount } = await supabase
    .from('contacts').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).not('reactivated_at', 'is', null);

  // ── 5. Avg response time ─────────────────────────────────────────────────
  const { data: recentMsgs } = await supabase
    .from('messages')
    .select('created_at, direction, conversation_id')
    .eq('tenant_id', tenant.id).gte('created_at', ago30)
    .order('created_at', { ascending: true })
    .limit(1000);
  const byConv = new Map<string, Array<{ created_at: string; direction: string }>>();
  for (const m of (recentMsgs as Array<{ created_at: string; direction: string; conversation_id: string }> | null) || []) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push(m);
  }
  let totalMs = 0;
  let pairs = 0;
  for (const msgs of byConv.values()) {
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i - 1].direction === 'inbound' && msgs[i].direction === 'outbound') {
        totalMs += new Date(msgs[i].created_at).getTime() - new Date(msgs[i - 1].created_at).getTime();
        pairs++;
      }
    }
  }
  const avgSec = pairs > 0 ? Math.round(totalMs / pairs / 1000) : 0;
  const avgLabel = avgSec < 60 ? `${avgSec}s` : `${Math.round(avgSec / 60)} min`;

  return (
    <div className="space-y-4">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Rendimiento de los últimos 30 días contra el periodo anterior.
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-element animate-delay-100">
        {kpis.map(k => (
          <div key={k.label} className="glass-card p-5">
            <div className="flex items-center justify-between">
              <span className={`w-10 h-10 rounded-full flex items-center justify-center ${k.tint}`}>
                <k.icon className="w-4 h-4" />
              </span>
              {k.delta !== null && (
                <span className={`text-[11px] font-medium inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                  k.delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}>
                  {k.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {k.delta >= 0 ? '+' : ''}{k.delta}%
                </span>
              )}
            </div>
            <p className="mt-3 text-3xl font-semibold text-zinc-900 tabular-nums">{k.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </section>

      {/* Trend charts (recharts) */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5 animate-element animate-delay-200">
        <div className="xl:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Actividad diaria</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Mensajes entrantes y citas agendadas.</p>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium">
              Últimos 30 días
            </span>
          </div>
          <AnalyticsCharts trend={trend} />
        </div>

        <div className="glass-card p-6 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500">Tiempo de respuesta</p>
              <p className="text-sm font-semibold text-zinc-900">Promedio (30d)</p>
            </div>
          </div>
          <p className="kpi-number text-5xl font-semibold mt-6 tabular-nums">{avgLabel}</p>
          <p className="text-xs text-zinc-500 mt-1">basado en {pairs} respuestas del agente.</p>

          <div className="mt-auto pt-6 border-t border-zinc-100">
            <p className="text-xs text-zinc-500">Pacientes reactivados</p>
            <p className="text-3xl font-semibold text-emerald-600 mt-1 tabular-nums">
              {reactivatedCount ?? 0}
            </p>
          </div>
        </div>
      </section>

      {/* Secondary analysis — 3 cards */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-element animate-delay-300">
        {/* No-shows by DOW */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-semibold text-zinc-900">No-shows por día</h3>
          </div>
          <p className="text-xs text-zinc-500">{noShows?.length ?? 0} no-shows en 90 días.</p>
          <div className="mt-6 flex items-end gap-2 h-36">
            {noShowByDow.map((count, i) => {
              const max = Math.max(...noShowByDow, 1);
              const pct = (count / max) * 100;
              const isWorst = count === max && count > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-md transition-all duration-500 ${isWorst ? 'bg-rose-400' : 'bg-[hsl(var(--brand-blue-soft))]'}`}
                      style={{ height: `${Math.max(pct, 6)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
                  <span className="text-[10px] uppercase text-zinc-400">{DOW_LABELS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reasons */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold text-zinc-900">Razones de cancelación</h3>
          <p className="text-xs text-zinc-500">{reasonsTotal} clasificadas.</p>
          {reasons.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-400">Sin datos aún.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {reasons.map((r) => {
                const pct = Math.round((100 * r.count) / reasonsTotal);
                return (
                  <li key={r.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-700">{r.label}</span>
                      <span className="text-zinc-500 tabular-nums">{r.count} · {pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div className="h-full bg-amber-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Revenue at risk */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold text-zinc-900">Revenue perdido por semana</h3>
          <p className="text-xs text-zinc-500">No-shows + canceladas.</p>
          <div className="mt-6 grid grid-cols-4 gap-2 items-end h-32">
            {weekPoints.map((p) => {
              const max = Math.max(...weekPoints.map(x => x.value), 1);
              const pct = (p.value / max) * 100;
              return (
                <div key={p.label} className="flex flex-col items-center gap-1.5 h-full">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-rose-400 to-amber-300 transition-all duration-500"
                      style={{ height: `${Math.max(pct, 8)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">
                    ${p.value > 999 ? `${Math.round(p.value / 1000)}k` : p.value}
                  </span>
                  <span className="text-[10px] uppercase text-zinc-400">{p.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
