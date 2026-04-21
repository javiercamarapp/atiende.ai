import { FileText, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { TrendAreaChart, AppointmentTypeBars } from '@/components/dashboard/kpi-charts';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Agendada', className: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]' },
  confirmed: { label: 'Confirmada', className: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]' },
  completed: { label: 'Completada', className: 'bg-emerald-50 text-emerald-700' },
  no_show: { label: 'No-show', className: 'bg-amber-50 text-amber-700' },
  cancelled: { label: 'Cancelada', className: 'bg-rose-50 text-rose-700' },
  ongoing: { label: 'En curso', className: 'bg-violet-50 text-violet-700' },
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
      .select('id, customer_name, customer_phone, datetime, duration_minutes, status, notes, staff:staff_id(name, speciality), services:service_id(name)')
      .eq('tenant_id', tenant.id)
      .gte('datetime', new Date(today.getTime() - 7 * 86_400_000).toISOString())
      .order('datetime', { ascending: true })
      .limit(50),
  ]);

  const weekApts = (weekApptsR.data || []) as { datetime: string; service_id: string | null }[];
  const trendBuckets = new Array(7).fill(0);
  for (const a of weekApts) {
    const d = new Date(a.datetime);
    if (d >= weekStart) trendBuckets[d.getDay()] += 1;
  }
  const trendData = WEEKDAYS_SHORT.map((label, i) => ({ label, value: trendBuckets[i] }));
  const totalWeek = trendBuckets.reduce((a: number, b: number) => a + b, 0);

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

  type AptRow = {
    id: string; customer_name: string | null; customer_phone: string;
    datetime: string; duration_minutes: number | null; status: string | null; notes: string | null;
    staff: { name: string; speciality: string | null } | { name: string; speciality: string | null }[] | null;
    services: { name: string } | { name: string }[] | null;
  };
  const list = (listR.data || []) as unknown as AptRow[];

  const todayCount = todayR.count ?? 0;
  const todayDelta = pctDelta(todayCount, yesterdayR.count ?? 0);
  const completedCount = completedR.count ?? 0;
  const completedDelta = pctDelta(completedCount, completedYestR.count ?? 0);
  const ongoingCount = ongoingR.count ?? 0;
  const ongoingDelta = pctDelta(ongoingCount, ongoingYestR.count ?? 0);
  const cancelledCount = cancelledR.count ?? 0;
  const cancelledDelta = pctDelta(cancelledCount, cancelledYestR.count ?? 0);

  return (
    <div className="space-y-6">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Control de citas, tendencias y tipos de servicio.
        </p>
      </header>

      {/* 4 stat cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-element">
        <StatCard
          label="Citas de hoy"
          value={todayCount}
          delta={todayDelta}
          description={`Capacidad disponible: ${Math.max(0, 30 - todayCount)} espacios`}
          icon={FileText}
        />
        <StatCard
          label="Completadas"
          value={completedCount}
          delta={completedDelta}
          description={`Las incompletas son ${todayCount - completedCount}`}
          icon={CheckCircle2}
        />
        <StatCard
          label="En curso"
          value={ongoingCount}
          delta={ongoingDelta}
          description={ongoingDelta?.positive === false ? 'Rendimiento más lento que ayer' : 'Rendimiento vs ayer'}
          icon={Clock}
        />
        <StatCard
          label="Canceladas"
          value={cancelledCount}
          delta={cancelledDelta ? { ...cancelledDelta, positive: !cancelledDelta.positive } : undefined}
          description={cancelledDelta?.positive ? 'Rendimiento peor que ayer' : 'Rendimiento mejor que ayer'}
          icon={XCircle}
        />
      </section>

      {/* Charts: Trends + Type breakdown */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 animate-element animate-delay-100">
        <div className="glass-card p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Tendencia de citas</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Total citas{' '}
                <span className="text-xl font-semibold text-zinc-900 tabular-nums ml-1">{totalWeek}</span>
              </p>
            </div>
            <span className="text-[11px] text-zinc-600 bg-zinc-100 rounded-full px-3 py-1.5 font-medium">
              Esta semana
            </span>
          </div>
          <TrendAreaChart data={trendData} />
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-900">Tipo de cita</h3>
            <button className="text-zinc-400 hover:text-zinc-600 text-xs">•••</button>
          </div>
          {typeSegments.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-xs text-zinc-400">Sin datos</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {typeSegments.map((seg) => {
                  const pct = Math.round((seg.count / typeTotal) * 100);
                  return (
                    <div key={seg.name} className="border-l-2 pl-2.5" style={{ borderColor: seg.color }}>
                      <p className="text-xs font-semibold text-zinc-900 truncate">{seg.name}</p>
                      <p className="text-sm font-semibold text-zinc-900 tabular-nums mt-0.5">
                        {pct}%
                      </p>
                      <p className="text-[10px] text-zinc-500">{seg.count} pacientes</p>
                    </div>
                  );
                })}
              </div>
              <AppointmentTypeBars segments={typeSegments} />
            </>
          )}
        </div>
      </section>

      {/* Appointments table */}
      <section className="glass-card overflow-hidden animate-element animate-delay-200">
        <div className="flex items-center justify-between px-6 py-4">
          <h3 className="text-sm font-semibold text-zinc-900">Citas</h3>
          <span className="text-[11px] text-zinc-600 bg-zinc-100 rounded-full px-3 py-1.5 font-medium">
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
              <thead>
                <tr className="border-t border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-3 text-left font-medium">Nombre</th>
                  <th className="px-6 py-3 text-left font-medium">Teléfono</th>
                  <th className="px-6 py-3 text-left font-medium">Doctor</th>
                  <th className="px-6 py-3 text-left font-medium">Servicio</th>
                  <th className="px-6 py-3 text-left font-medium">Notas</th>
                  <th className="px-6 py-3 text-left font-medium">Fecha</th>
                  <th className="px-6 py-3 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const d = new Date(a.datetime);
                  const end = new Date(d.getTime() + (a.duration_minutes || 30) * 60_000);
                  const status = STATUS_STYLES[a.status || 'scheduled'] || STATUS_STYLES.scheduled;
                  const svc = Array.isArray(a.services) ? a.services[0] : a.services;
                  const doc = Array.isArray(a.staff) ? a.staff[0] : a.staff;
                  const name = a.customer_name || a.customer_phone;
                  const initials = name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                  return (
                    <tr key={a.id} className="border-t border-zinc-100 last:border-b-0 hover:bg-zinc-50/60 transition">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-[11px] font-semibold text-zinc-600 shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-900 truncate">{name}</p>
                            <p className="text-[11px] text-zinc-400 tabular-nums">#{a.id.slice(0, 8).toUpperCase()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-zinc-600 tabular-nums">{a.customer_phone}</td>
                      <td className="px-6 py-3.5">
                        <p className="text-sm text-zinc-900">{doc?.name ?? '—'}</p>
                        <p className="text-[11px] text-zinc-400">{doc?.speciality ?? ''}</p>
                      </td>
                      <td className="px-6 py-3.5 text-zinc-700">{svc?.name ?? '—'}</td>
                      <td className="px-6 py-3.5 text-zinc-500 max-w-[180px] truncate">
                        {a.notes || '—'}
                      </td>
                      <td className="px-6 py-3.5 tabular-nums whitespace-nowrap">
                        <p className="text-sm text-zinc-900">
                          {d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                          status.className,
                        )}>
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
