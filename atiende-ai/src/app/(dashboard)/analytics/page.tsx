// ─────────────────────────────────────────────────────────────────────────────
// Analytics — CSS charts (sin librerías). 4 secciones:
//   1. No-show por día de la semana (bar chart vertical)
//   2. Top razones de cancelación (barras horizontales)
//   3. Revenue at risk últimas 4 semanas (línea de puntos)
//   4. Pacientes reactivados por RETENCIÓN
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabase } from '@/lib/supabase/server';

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

  const ago90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // ── 1. No-show por día de la semana ──────────────────────────────────────
  const { data: noShows } = await supabase
    .from('appointments')
    .select('datetime')
    .eq('tenant_id', tenant.id)
    .eq('status', 'no_show')
    .gte('datetime', ago90);

  const noShowByDow = new Array(7).fill(0);
  for (const a of (noShows as Array<{ datetime: string }> | null) || []) {
    const dow = new Date(a.datetime).getDay();
    noShowByDow[dow]++;
  }
  const noShowMax = Math.max(...noShowByDow, 1);

  // ── 2. Top razones de cancelación ────────────────────────────────────────
  const { data: cancelled } = await supabase
    .from('appointments')
    .select('cancellation_reason')
    .eq('tenant_id', tenant.id)
    .eq('status', 'cancelled')
    .not('cancellation_reason', 'is', null)
    .gte('datetime', ago90);

  const reasonCounts = new Map<string, number>();
  for (const c of (cancelled as Array<{ cancellation_reason: string }> | null) || []) {
    const r = c.cancellation_reason || 'sin_razon';
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }
  const reasonsList = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);
  const reasonsTotal = reasonsList.reduce((s, [, n]) => s + n, 0) || 1;

  // ── 3. Revenue at risk últimas 4 semanas (datos actuales + manual) ───────
  // La materialized view solo da el dato de hoy. Para históricos agregamos por
  // semana desde appointments canceladas/no_show.
  const weeks = 4;
  const points: Array<{ label: string; value: number }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(Date.now() - (w + 1) * 7 * 86_400_000);
    const weekEnd = new Date(Date.now() - w * 7 * 86_400_000);

    const { data: weekApts } = await supabase
      .from('appointments')
      .select('price_mxn')
      .eq('tenant_id', tenant.id)
      .in('status', ['no_show', 'cancelled'])
      .gte('datetime', weekStart.toISOString())
      .lt('datetime', weekEnd.toISOString());

    const totalLost = ((weekApts as Array<{ price_mxn: number | null }> | null) || [])
      .reduce((s, a) => s + (Number(a.price_mxn) || 500), 0);

    const label = w === 0 ? 'Esta' : `-${w}`;
    points.push({ label, value: totalLost });
  }
  const pointsMax = Math.max(...points.map((p) => p.value), 1);

  // ── 4. Pacientes reactivados por RETENCIÓN ───────────────────────────────
  const { data: reactivated, count: reactivatedCount } = await supabase
    .from('contacts')
    .select('id, name, phone, reactivated_at', { count: 'exact' })
    .eq('tenant_id', tenant.id)
    .not('reactivated_at', 'is', null)
    .order('reactivated_at', { ascending: false })
    .limit(1);

  const lastReactivated = (reactivated as Array<{ name: string | null; phone: string; reactivated_at: string }> | null)?.[0];

  return (
    <div className="space-y-8">
      <header className="animate-element">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Panel</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">Analytics</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Últimos 90 días de actividad operativa.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── 1. No-show por DOW ─────────────────────────────────────────── */}
        <section className="stagger-item glass-card p-6">
          <h3 className="text-sm font-medium text-zinc-800">No-shows por día de la semana</h3>
          <p className="mt-1 text-xs text-zinc-500">{noShows?.length ?? 0} no-shows en 90 días.</p>

          <div className="mt-6 flex items-end gap-3 h-40">
            {noShowByDow.map((count, i) => {
              const pct = (count / noShowMax) * 100;
              const isWorst = count === noShowMax && count > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-500 ${
                        isWorst ? 'bg-red-500/70' : 'bg-white/15'
                      }`}
                      style={{ height: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                    {DOW_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 2. Top razones de cancelación ──────────────────────────────── */}
        <section className="stagger-item glass-card p-6">
          <h3 className="text-sm font-medium text-zinc-800">Top razones de cancelación</h3>
          <p className="mt-1 text-xs text-zinc-500">{reasonsTotal} cancelaciones clasificadas.</p>

          {reasonsList.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-400">Sin datos aún.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {reasonsList.map(([reason, count], idx) => {
                const pct = Math.round((100 * count) / reasonsTotal);
                return (
                  <li
                    key={reason}
                    className="space-y-1.5 stagger-item"
                    style={{ animationDelay: `${100 + idx * 50}ms` }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-800">{REASON_LABELS[reason] ?? reason}</span>
                      <span className="text-zinc-600 tabular-nums">{count} · {pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-50 overflow-hidden">
                      <div
                        className="h-full bg-amber-500/70 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── 3. Revenue at risk histórico ────────────────────────────────── */}
        <section className="stagger-item glass-card p-6">
          <h3 className="text-sm font-medium text-zinc-800">Revenue perdido por semana</h3>
          <p className="mt-1 text-xs text-zinc-500">Últimas 4 semanas · no-shows + canceladas.</p>

          <div className="relative mt-6 h-40">
            {/* Puntos + línea conectora */}
            <svg
              className="absolute inset-0 w-full h-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                fill="none"
                stroke="rgba(245, 158, 11, 0.6)"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
                points={points
                  .map((p, i) => {
                    const x = (i / Math.max(1, points.length - 1)) * 100;
                    const y = 100 - (p.value / pointsMax) * 90;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />
              {points.map((p, i) => {
                const x = (i / Math.max(1, points.length - 1)) * 100;
                const y = 100 - (p.value / pointsMax) * 90;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r="1.2"
                    fill="rgb(245, 158, 11)"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {points.map((p) => (
              <div key={p.label} className="text-center">
                <p className="text-sm font-medium text-zinc-900 tabular-nums">
                  ${Math.round(p.value).toLocaleString('es-MX')}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                  {p.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. Pacientes reactivados ────────────────────────────────────── */}
        <section className="stagger-item glass-card p-6">
          <h3 className="text-sm font-medium text-zinc-800">Pacientes reactivados</h3>
          <p className="mt-1 text-xs text-zinc-500">Via agente RETENCIÓN.</p>

          <div className="mt-6 flex flex-col items-start gap-2">
            <p className="kpi-number text-6xl font-semibold tabular-nums">
              {reactivatedCount ?? 0}
            </p>
            <p className="text-xs text-emerald-600/80">pacientes recuperados</p>
          </div>

          {lastReactivated && (
            <div className="mt-6 rounded-lg border border-zinc-100 bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                Último reactivado
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {lastReactivated.name || lastReactivated.phone}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {new Date(lastReactivated.reactivated_at).toLocaleDateString('es-MX', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
