import { FileText, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { TrendAreaChart, AppointmentTypeBars } from '@/components/dashboard/kpi-charts';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Agendada', className: 'bg-zinc-100 text-zinc-700' },
  confirmed: { label: 'Confirmada', className: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]' },
  completed: { label: 'Completada', className: 'bg-emerald-50 text-emerald-700' },
  no_show: { label: 'No-show', className: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelada', className: 'bg-zinc-50 text-zinc-500' },
  ongoing: { label: 'En curso', className: 'bg-[hsl(var(--brand-blue))] text-white' },
};

const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const TYPE_COLORS = [
  'hsl(222 47% 11%)',
  'hsl(235 84% 55%)',
  'hsl(235 70% 72%)',
  'hsl(235 60% 88%)',
];

function pctDelta(curr: number, prev: number): { value: number; positive: boolean } | undefined {
  if (prev === 0) {
    if (curr === 0) return undefined;
    return { value: 100, positive: true };
  }
  const diff = Math.round(((curr - prev) / prev) * 100);
  if (diff === 0) return undefined;
  return { value: Math.abs(diff), positive: diff >= 0 };
}

export default async function AppointmentsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant found</div>;

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekStart = new Date(today.getTime() - today.getDay() * 86_400_000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);

  const [todayR, yesterdayR, completedR, completedYestR, ongoingR, ongoingYestR, cancelledR, cancelledYestR] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', yesterday.toISOString()).lt('datetime', today.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()).eq('status', 'completed'),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', yesterday.toISOString()).lt('datetime', today.toISOString()).eq('status', 'completed'),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()).in('status', ['scheduled', 'confirmed']),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', yesterday.toISOString()).lt('datetime', today.toISOString()).in('status', ['scheduled', 'confirmed']),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()).in('status', ['cancelled', 'no_show']),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', yesterday.toISOString()).lt('datetime', today.toISOString()).in('status', ['cancelled', 'no_show']),
  ]);

  const [weekApptsR, listR] = await Promise.all([
    supabase.from('appointments').select('datetime, service_id').eq('tenant_id', tenant.id)
      .gte('datetime', prevWeekStart.toISOString())
      .lt('datetime', new Date(weekStart.getTime() + 7 * 86_400_000).toISOString()),
    supabase
      .from('appointments')
      .select('id, customer_name, customer_phone, datetime, duration_minutes, status, notes, staff(name), services(name)')
      .eq('tenant_id', tenant.id)
      .gte('datetime', new Date(today.getTime() - 3 * 86_400_000).toISOString())
      .order('datetime', { ascending: true })
      .limit(50),
  ]);

  const weekApts = (weekApptsR.data || []) as { datetime: string; service_id: string | null }[];
  const trendBuckets = new Array(7).fill(0);
  const prevTrendBuckets = new Array(7).fill(0);
  for (const a of weekApts) {
    const d = new Date(a.datetime);
    const wd = d.getDay();
    if (d >= weekStart) trendBuckets[wd] += 1;
    else prevTrendBuckets[wd] += 1;
  }
  const trendData = WEEKDAYS_SHORT.map((label, i) => ({ label, value: trendBuckets[i] }));
  const totalWeek = trendBuckets.reduce((a, b) => a + b, 0);

  const { data: servicesRaw } = await supabase.from('services').select('id, name').eq('tenant_id', tenant.id).limit(4);
  const services = (servicesRaw || []) as { id: string; name: string }[];
  const serviceCountsMap = new Map<string, number>();
  for (const a of weekApts) {
    if (!a.service_id) continue;
    serviceCountsMap.set(a.service_id, (serviceCountsMap.get(a.service_id) || 0) + 1);
  }
  const typeSegments = services.map((s, i) => ({
    name: s.name,
    count: serviceCountsMap.get(s.id) || 0,
    color: TYPE_COLORS[i % TYPE_COLORS.length],
  }));
  const typeTotal = typeSegments.reduce((a, b) => a + b.count, 0) || 1;

  const list = (listR.data || []) as unknown as {
    id: string;
    customer_name: string | null;
    customer_phone: string;
    datetime: string;
    duration_minutes: number | null;
    status: string | null;
    notes: string | null;
    staff: { name: string } | { name: string }[] | null;
    services: { name: string } | { name: string }[] | null;
  }[];

  const todayDelta = pctDelta(todayR.count ?? 0, yesterdayR.count ?? 0);
  const completedDelta = pctDelta(completedR.count ?? 0, completedYestR.count ?? 0);
  const ongoingDelta = pctDelta(ongoingR.count ?? 0, ongoingYestR.count ?? 0);
  const cancelledDelta = pctDelta(cancelledR.count ?? 0, cancelledYestR.count ?? 0);

  return (
    <div className="space-y-6">
      <header className="animate-element">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Citas</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Control de citas, tendencias y tipos de servicio.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Citas de hoy"
          value={todayR.count ?? 0}
          delta={todayDelta}
          subtitle={`${yesterdayR.count ?? 0} ayer`}
          icon={FileText}
          variant="primary"
        />
        <StatCard
          label="Completadas"
          value={completedR.count ?? 0}
          delta={completedDelta}
          subtitle={`${completedYestR.count ?? 0} ayer`}
          icon={CheckCircle2}
        />
        <StatCard
          label="En curso"
          value={ongoingR.count ?? 0}
          delta={ongoingDelta}
          subtitle="agendadas o confirmadas"
          icon={Clock}
        />
        <StatCard
          label="Canceladas"
          value={cancelledR.count ?? 0}
          delta={cancelledDelta ? { ...cancelledDelta, positive: !cancelledDelta.positive } : undefined}
          subtitle={`${cancelledYestR.count ?? 0} ayer`}
          icon={XCircle}
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Tendencia de citas</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Esta semana</p>
            </div>
            <span className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
              Semana
            </span>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-zinc-900 mb-2">
            {totalWeek}
            <span className="text-xs font-normal text-zinc-500 ml-2">total semana</span>
          </p>
          <TrendAreaChart data={trendData} />
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-900">Tipos de servicio</h3>
            <span className="text-[11px] text-zinc-500">Esta semana</span>
          </div>
          {typeSegments.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-xs text-zinc-400">
              Sin datos
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {typeSegments.map((seg) => {
                  const pct = Math.round((seg.count / typeTotal) * 100);
                  return (
                    <div key={seg.name}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-1 h-4 rounded-sm" style={{ background: seg.color }} />
                        <span className="text-[11px] text-zinc-500 truncate">{seg.name}</span>
                      </div>
                      <p className="text-sm font-semibold text-zinc-900 tabular-nums">
                        {pct}% <span className="text-[10px] font-normal text-zinc-500">{seg.count} citas</span>
                      </p>
                    </div>
                  );
                })}
              </div>
              <AppointmentTypeBars segments={typeSegments} />
            </>
          )}
        </div>
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-semibold text-zinc-900">Citas</h3>
          <span className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
            Esta semana
          </span>
        </div>

        {list.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-900">Sin citas todavía</p>
            <p className="text-xs text-zinc-500 mt-1">Las citas agendadas por el agente aparecerán aquí.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50/50 border-b border-zinc-100">
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-5 py-3 font-medium">Paciente</th>
                  <th className="px-5 py-3 font-medium">Teléfono</th>
                  <th className="px-5 py-3 font-medium">Doctor</th>
                  <th className="px-5 py-3 font-medium">Servicio</th>
                  <th className="px-5 py-3 font-medium">Notas</th>
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-5 py-3 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const d = new Date(a.datetime);
                  const end = new Date(d.getTime() + (a.duration_minutes || 30) * 60_000);
                  const status = STATUS_STYLES[a.status || 'scheduled'] || STATUS_STYLES.scheduled;
                  const svc = Array.isArray(a.services) ? a.services[0] : a.services;
                  const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
                  return (
                    <tr key={a.id} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50 transition">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center text-[hsl(var(--brand-blue))] text-xs font-semibold shrink-0">
                            {(a.customer_name || a.customer_phone).slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900 truncate">
                              {a.customer_name || 'Sin nombre'}
                            </p>
                            <p className="text-[11px] text-zinc-400 tabular-nums">#{a.id.slice(0, 8)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-zinc-600 tabular-nums">{a.customer_phone}</td>
                      <td className="px-5 py-4 text-zinc-600">
                        {staff?.name || <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-zinc-600">
                        {svc?.name || <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-zinc-500 max-w-[200px] truncate">
                        {a.notes || <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-zinc-600 tabular-nums whitespace-nowrap">
                        {d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                        <p className="text-[11px] text-zinc-400">
                          {d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
