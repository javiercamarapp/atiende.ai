import Link from 'next/link';
import { Users, Calendar, MessageSquare, ChevronRight } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { WeekdayBarChart, ServicesDonut, RevenueLineChart } from '@/components/dashboard/kpi-charts';
import { MiniCalendar } from '@/components/dashboard/mini-calendar';
import { AgendaWidget } from '@/components/dashboard/agenda-widget';
import { IntelligenceAlerts } from '@/components/dashboard/intelligence-alerts';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const DONUT_COLORS = [
  'hsl(235 84% 55%)',
  'hsl(235 70% 72%)',
  'hsl(235 60% 85%)',
  'hsl(222 47% 11%)',
  'hsl(220 13% 70%)',
  'hsl(220 13% 88%)',
];

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
  confirmed: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-rose-50 text-rose-700',
  no_show: 'bg-amber-50 text-amber-700',
  ongoing: 'bg-violet-50 text-violet-700',
};

function pctDelta(curr: number, prev: number): { value: number; positive: boolean } | undefined {
  if (prev === 0) {
    if (curr === 0) return undefined;
    return { value: 100, positive: true };
  }
  const diff = Math.round(((curr - prev) / prev) * 100);
  if (diff === 0) return undefined;
  return { value: Math.abs(diff), positive: diff >= 0 };
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant found</div>;

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const weekStart = new Date(today.getTime() - today.getDay() * 86_400_000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [
    patientsTotalR,
    patientsPrevMonthR,
    appointmentsTodayR,
    appointmentsYestR,
    conversationsWeekR,
    conversationsPrevWeekR,
    weekAppointmentsR,
    upcomingAppointmentsR,
    servicesR,
    staffR,
    recentAptsR,
  ] = await Promise.all([
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .lt('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', today.toISOString()).lt('datetime', tomorrow.toISOString()),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('datetime', new Date(today.getTime() - 86_400_000).toISOString()).lt('datetime', today.toISOString()),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('created_at', weekStart.toISOString()),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .gte('created_at', prevWeekStart.toISOString()).lt('created_at', weekStart.toISOString()),
    supabase.from('appointments').select('datetime, service_id, price_mxn, status').eq('tenant_id', tenant.id)
      .gte('datetime', prevWeekStart.toISOString()).lt('datetime', new Date(weekStart.getTime() + 7 * 86_400_000).toISOString()),
    supabase.from('appointments').select('id, customer_name, customer_phone, datetime, status, services:service_id(name)').eq('tenant_id', tenant.id)
      .gte('datetime', now.toISOString()).order('datetime').limit(5),
    supabase.from('services').select('id, name').eq('tenant_id', tenant.id).limit(6),
    supabase.from('staff').select('id, name, role, speciality, active').eq('tenant_id', tenant.id).limit(10),
    supabase.from('appointments')
      .select('id, customer_name, customer_phone, datetime, end_datetime, status, services:service_id(name), staff:staff_id(name, speciality)')
      .eq('tenant_id', tenant.id)
      .gte('datetime', new Date(today.getTime() - 7 * 86_400_000).toISOString())
      .order('datetime', { ascending: false })
      .limit(6),
  ]);

  const patientsTotal = patientsTotalR.count ?? 0;
  const patientsPrev = patientsPrevMonthR.count ?? 0;
  const patientsDelta = pctDelta(patientsTotal, patientsPrev);

  const appointmentsToday = appointmentsTodayR.count ?? 0;
  const appointmentsYest = appointmentsYestR.count ?? 0;
  const appointmentsDelta = pctDelta(appointmentsToday, appointmentsYest);

  const conversationsWeek = conversationsWeekR.count ?? 0;
  const conversationsPrevWeek = conversationsPrevWeekR.count ?? 0;
  const conversationsDelta = pctDelta(conversationsWeek, conversationsPrevWeek);

  const weekApts = (weekAppointmentsR.data || []) as { datetime: string; service_id: string | null; price_mxn: number | null; status: string | null }[];
  const weekdayCurr = new Array(7).fill(0);
  const weekdayPrev = new Array(7).fill(0);
  for (const a of weekApts) {
    const d = new Date(a.datetime);
    const wd = d.getDay();
    if (d >= weekStart) weekdayCurr[wd] += 1;
    else weekdayPrev[wd] += 1;
  }
  const weekdayData = WEEKDAYS.map((day, i) => ({
    day,
    count: weekdayCurr[i],
    prev: weekdayPrev[i],
  }));

  const serviceCount = new Map<string, number>();
  for (const a of weekApts) {
    if (!a.service_id) continue;
    serviceCount.set(a.service_id, (serviceCount.get(a.service_id) || 0) + 1);
  }
  const services = (servicesR.data || []) as { id: string; name: string }[];
  const donutData = services
    .map((s, i) => ({
      name: s.name,
      value: serviceCount.get(s.id) || 0,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const donutTotal = donutData.reduce((sum, d) => sum + d.value, 0);

  const revenueStart = sixMonthsAgo.toISOString();
  const { data: revenueRowsRaw } = await supabase
    .from('appointments')
    .select('datetime, price_mxn, status')
    .eq('tenant_id', tenant.id)
    .gte('datetime', revenueStart);
  const revenueRows = (revenueRowsRaw || []) as { datetime: string; price_mxn: number | null; status: string | null }[];

  const revenueByMonth = new Map<string, { income: number; expense: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    revenueByMonth.set(key, { income: 0, expense: 0 });
  }
  for (const r of revenueRows) {
    const d = new Date(r.datetime);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const entry = revenueByMonth.get(key);
    if (!entry) continue;
    if (r.status === 'completed') entry.income += Number(r.price_mxn || 0);
    else if (r.status === 'no_show' || r.status === 'cancelled') entry.expense += Number(r.price_mxn || 0) * 0.3;
  }
  const revenueData = Array.from(revenueByMonth.entries()).map(([key, v]) => {
    const [y, m] = key.split('-').map(Number);
    return { month: MONTHS_SHORT[m] + ' ' + String(y).slice(-2), income: Math.round(v.income), expense: Math.round(v.expense) };
  });

  type UpcomingRow = { id: string; customer_name: string | null; customer_phone: string; datetime: string; status: string | null; services: { name: string } | { name: string }[] | null };
  const upcoming = (upcomingAppointmentsR.data || []) as unknown as UpcomingRow[];
  const agendaItems = upcoming.map((a) => {
    const d = new Date(a.datetime);
    const end = new Date(d.getTime() + 30 * 60_000);
    const svc = Array.isArray(a.services) ? a.services[0] : a.services;
    return {
      id: a.id,
      title: a.customer_name || a.customer_phone,
      tag: svc?.name || undefined,
      day: d.getDate(),
      weekday: WEEKDAYS[d.getDay()],
      timeRange: `${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
    };
  });

  const highlightedDates = upcoming.map((a) => new Date(a.datetime).toISOString().slice(0, 10));

  type RecentAptRow = {
    id: string; customer_name: string | null; customer_phone: string;
    datetime: string; end_datetime: string | null; status: string;
    services: { name: string } | { name: string }[] | null;
    staff: { name: string; speciality: string | null } | { name: string; speciality: string | null }[] | null;
  };
  const recentApts = ((recentAptsR.data || []) as unknown as RecentAptRow[]).map((a) => {
    const svc = Array.isArray(a.services) ? a.services[0] : a.services;
    const doc = Array.isArray(a.staff) ? a.staff[0] : a.staff;
    return { ...a, serviceName: svc?.name ?? '—', staffName: doc?.name ?? '—', staffSpeciality: doc?.speciality ?? '' };
  });

  const allStaff = (staffR.data || []) as { id: string; name: string; role: string | null; speciality: string | null; active: boolean }[];
  const activeStaff = allStaff.filter((s) => s.active);
  const inactiveStaff = allStaff.filter((s) => !s.active);

  return (
    <div className="space-y-6">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Hola {tenant.name?.split(' ')[0] || 'doctor'}, bienvenido de vuelta.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* ─── MAIN CONTENT (3 cols) ─── */}
        <div className="xl:col-span-3 space-y-6">
          {/* Stat cards row */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-element">
            <StatCard
              label="Conversaciones"
              value={conversationsWeek.toLocaleString('es-MX')}
              delta={conversationsDelta}
              description="vs semana previa"
              icon={MessageSquare}
            />
            <StatCard
              label="Pacientes totales"
              value={patientsTotal.toLocaleString('es-MX')}
              delta={patientsDelta}
              description="vs mes pasado"
              icon={Users}
            />
            <StatCard
              label="Citas hoy"
              value={appointmentsToday}
              delta={appointmentsDelta}
              description="vs ayer"
              icon={Calendar}
            />
          </section>

          {/* Charts row: bar chart + donut */}
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 animate-element animate-delay-100">
            <div className="glass-card p-5 lg:col-span-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">Citas por día</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Total citas{' '}
                    <span className="text-xl font-semibold text-zinc-900 tabular-nums ml-1">
                      {weekdayCurr.reduce((a: number, b: number) => a + b, 0)}
                    </span>
                  </p>
                </div>
                <span className="text-[11px] text-zinc-600 bg-zinc-100 rounded-full px-3 py-1.5 font-medium">
                  Esta semana
                </span>
              </div>
              <WeekdayBarChart data={weekdayData} />
            </div>

            <div className="glass-card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">Servicios</h3>
                <button className="text-zinc-400 hover:text-zinc-600 text-xs">•••</button>
              </div>
              {donutTotal > 0 ? (
                <>
                  <ServicesDonut data={donutData} total={donutTotal} />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {donutData.slice(0, 6).map((d) => (
                      <div key={d.name} className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: d.color }} />
                        <div className="min-w-0">
                          <p className="text-[11px] text-zinc-600 truncate">{d.name}</p>
                          <p className="text-[11px] font-medium text-zinc-900 tabular-nums">
                            {d.value} {d.value === 1 ? 'cita' : 'citas'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-56 flex items-center justify-center text-xs text-zinc-400">
                  Sin datos de servicios
                </div>
              )}
            </div>
          </section>

          {/* Revenue + Reports/Alerts */}
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 animate-element animate-delay-200">
            <div className="glass-card p-5 lg:col-span-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">Ingresos</h3>
                <span className="text-[11px] text-zinc-600 bg-zinc-100 rounded-full px-3 py-1.5 font-medium">
                  6 meses
                </span>
              </div>
              <RevenueLineChart data={revenueData} />
            </div>

            <div className="lg:col-span-2">
              <IntelligenceAlerts tenantId={tenant.id} />
            </div>
          </section>

          {/* Patient Appointment table */}
          <section className="glass-card overflow-hidden animate-element animate-delay-300">
            <div className="flex items-center justify-between px-6 py-4">
              <h3 className="text-sm font-semibold text-zinc-900">Citas recientes</h3>
              <Link
                href="/appointments"
                className="text-[11px] text-zinc-600 bg-zinc-100 rounded-full px-3 py-1.5 font-medium hover:bg-zinc-200 transition inline-flex items-center gap-1"
              >
                Ver todas <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-6 py-3 text-left font-medium">Nombre</th>
                    <th className="px-6 py-3 text-left font-medium">Doctor</th>
                    <th className="px-6 py-3 text-left font-medium">Servicio</th>
                    <th className="px-6 py-3 text-left font-medium">Fecha y hora</th>
                    <th className="px-6 py-3 text-right font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recentApts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-xs text-zinc-400">
                        Sin citas recientes
                      </td>
                    </tr>
                  ) : (
                    recentApts.map((a) => {
                      const d = new Date(a.datetime);
                      const endD = a.end_datetime ? new Date(a.end_datetime) : new Date(d.getTime() + 30 * 60_000);
                      const name = a.customer_name || a.customer_phone;
                      const shortId = `#${a.id.slice(0, 8).toUpperCase()}`;
                      const initials = name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                      return (
                        <tr key={a.id} className="border-t border-zinc-100 hover:bg-zinc-50/60 transition">
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-[11px] font-semibold text-zinc-600 shrink-0">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-900 truncate">{name}</p>
                                <p className="text-[11px] text-zinc-400 tabular-nums">{shortId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <p className="text-sm text-zinc-900">{a.staffName}</p>
                            <p className="text-[11px] text-zinc-400">{a.staffSpeciality}</p>
                          </td>
                          <td className="px-6 py-3.5 text-zinc-700">{a.serviceName}</td>
                          <td className="px-6 py-3.5 tabular-nums whitespace-nowrap">
                            <p className="text-sm text-zinc-900">
                              {d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-[11px] text-zinc-400">
                              {d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - {endD.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize',
                              STATUS_STYLES[a.status] ?? 'bg-zinc-100 text-zinc-600',
                            )}>
                              {a.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* ─── RIGHT SIDEBAR (1 col) ─── */}
        <aside className="space-y-4">
          {/* Mini Calendar */}
          <MiniCalendar highlightedDates={highlightedDates} />

          {/* Agenda */}
          <AgendaWidget items={agendaItems} />

          {/* Doctors' Schedule / Staff */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-900">Equipo</h3>
              <button className="text-zinc-400 hover:text-zinc-600 text-xs">•••</button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center mb-4">
              <div>
                <p className="text-xl font-semibold tabular-nums text-zinc-900">{allStaff.length}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">Total</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums text-zinc-900">{activeStaff.length}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">Activos</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums text-zinc-900">{inactiveStaff.length}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">Inactivos</p>
              </div>
            </div>

            <ul className="space-y-2.5">
              {allStaff.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-[11px] font-semibold text-zinc-600 shrink-0">
                      {s.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-900 truncate">{s.name}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{s.speciality || s.role || '—'}</p>
                    </div>
                  </div>
                  <span className={cn(
                    'text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0',
                    s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
                  )}>
                    {s.active ? 'Activo' : 'Inactivo'}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Agent status */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-900">Agente IA</h3>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Activo
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-xl font-semibold tabular-nums text-zinc-900">24/7</p>
                <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Disponible</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums text-zinc-900">
                  {conversationsWeek}
                </p>
                <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Esta semana</p>
              </div>
            </div>
            <Link
              href="/conversations"
              className="mt-4 block text-center text-xs font-medium text-[hsl(var(--brand-blue))] bg-[hsl(var(--brand-blue-soft))] rounded-lg py-2 hover:opacity-80 transition"
            >
              Ver conversaciones
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
