import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Edit3,
  MessageSquare,
  Activity,
  Heart,
  Scale,
  Thermometer,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { BloodPressureChart } from '@/components/dashboard/kpi-charts';
import { cn } from '@/lib/utils';

interface ContactDetail {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  tags: string[] | null;
  lead_score: number | null;
  lead_temperature: string | null;
  last_contact_at: string | null;
  health_score: number | null;
  churn_probability: number | null;
  lifetime_value_mxn: number | null;
  next_visit_predicted_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
  confirmed: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-rose-50 text-rose-700',
  no_show: 'bg-amber-50 text-amber-700',
  ongoing: 'bg-violet-50 text-violet-700',
};

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return phone.slice(-2);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMXN(n: number | null): string {
  return `$${(n ?? 0).toLocaleString('es-MX')}`;
}

function yearsSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 86_400_000));
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, business_type')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) return <div>No tenant found</div>;

  const { data: contact } = (await supabase
    .from('contacts')
    .select(
      'id, name, phone, email, tags, lead_score, lead_temperature, last_contact_at, health_score, churn_probability, lifetime_value_mxn, next_visit_predicted_at, metadata, created_at',
    )
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()) as { data: ContactDetail | null };

  if (!contact) notFound();

  const { data: aptsData } = await supabase
    .from('appointments')
    .select('id, datetime, end_datetime, status, notes, staff:staff_id(name), services:service_id(name)')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', contact.phone)
    .order('datetime', { ascending: false })
    .limit(20);

  type AptRow = {
    id: string;
    datetime: string;
    end_datetime: string | null;
    status: string;
    notes: string | null;
    staff: { name: string } | { name: string }[] | null;
    services: { name: string } | { name: string }[] | null;
  };
  const appointments = ((aptsData || []) as unknown as AptRow[]).map((a) => {
    const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
    const svc = Array.isArray(a.services) ? a.services[0] : a.services;
    return {
      id: a.id,
      datetime: a.datetime,
      end_datetime: a.end_datetime,
      status: a.status,
      notes: a.notes,
      staffName: staff?.name ?? '—',
      serviceName: svc?.name ?? '—',
    };
  });

  const completedCount = appointments.filter((a) => a.status === 'completed').length;
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const upcoming = appointments.find(
    (a) => a.status !== 'cancelled' && new Date(a.datetime).getTime() > nowMs,
  );
  const age = yearsSince(contact.created_at);
  const tags = contact.tags || [];

  const bloodPressureData = [
    { month: 'Ene', top: 120, bottom: -80 },
    { month: 'Feb', top: 118, bottom: -78 },
    { month: 'Mar', top: 125, bottom: -82 },
    { month: 'Abr', top: 122, bottom: -80 },
    { month: 'May', top: 119, bottom: -77 },
    { month: 'Jun', top: 121, bottom: -79 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 animate-element">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Pacientes
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <aside className="xl:col-span-1 space-y-6">
          <div className="glass-card p-6 text-center animate-element animate-delay-100">
            <div className="relative inline-block">
              <div className="w-24 h-24 mx-auto rounded-full bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center text-3xl font-semibold text-[hsl(var(--brand-blue))]">
                {initials(contact.name, contact.phone)}
              </div>
              <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">
              {contact.name || contact.phone}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">#{contact.id.slice(0, 8).toUpperCase()}</p>

            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {tags.length > 0 ? (
                tags.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-medium bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] rounded-md px-2 py-0.5"
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[10px] font-medium bg-zinc-100 text-zinc-600 rounded-md px-2 py-0.5">
                  Sin etiquetas
                </span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[hsl(var(--brand-blue))] text-white text-xs font-medium hover:opacity-90 transition">
                <MessageSquare className="w-3.5 h-3.5" />
                Mensaje
              </button>
              <button className="inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white border border-zinc-200 text-zinc-700 text-xs font-medium hover:border-zinc-300 transition">
                <Edit3 className="w-3.5 h-3.5" />
                Editar
              </button>
            </div>
          </div>

          <div className="glass-card p-5 animate-element animate-delay-200">
            <h3 className="text-sm font-semibold text-zinc-900 mb-4">Información de contacto</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Teléfono</dt>
                  <dd className="text-zinc-900 tabular-nums truncate">{contact.phone}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Email</dt>
                  <dd className="text-zinc-900 truncate">{contact.email || '—'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Alta</dt>
                  <dd className="text-zinc-900">{fmtDate(contact.created_at)}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Última visita</dt>
                  <dd className="text-zinc-900">{fmtDate(contact.last_contact_at)}</dd>
                </div>
              </div>
            </dl>
          </div>

          <div className="glass-card p-5 animate-element animate-delay-300">
            <h3 className="text-sm font-semibold text-zinc-900 mb-4">Próxima cita</h3>
            {upcoming ? (
              <div className="rounded-xl bg-[hsl(var(--brand-blue-soft))] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--brand-blue))] font-medium">
                  {upcoming.serviceName}
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">
                  {fmtDateTime(upcoming.datetime)}
                </p>
                <p className="mt-1 text-xs text-zinc-600">Con {upcoming.staffName}</p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4">Sin cita programada</p>
            )}
          </div>
        </aside>

        <div className="xl:col-span-3 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-element animate-delay-100">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center">
                  <Heart className="w-4 h-4 text-[hsl(var(--brand-blue))]" />
                </div>
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 inline-flex items-center gap-0.5">
                  <TrendingUp className="w-3 h-3" />
                  Saludable
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Health score</p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-900 mt-0.5">
                {contact.health_score ?? 0}
                <span className="text-xs text-zinc-400 font-normal">/100</span>
              </p>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center">
                  <Scale className="w-4 h-4 text-zinc-700" />
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium rounded-full px-2 py-0.5 inline-flex items-center gap-0.5',
                    (contact.churn_probability ?? 0) > 50
                      ? 'text-rose-700 bg-rose-50'
                      : 'text-emerald-700 bg-emerald-50',
                  )}
                >
                  {(contact.churn_probability ?? 0) > 50 ? (
                    <TrendingDown className="w-3 h-3" />
                  ) : (
                    <TrendingUp className="w-3 h-3" />
                  )}
                  {(contact.churn_probability ?? 0) > 50 ? 'Alto' : 'Bajo'}
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Riesgo churn</p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-900 mt-0.5">
                {contact.churn_probability ?? 0}
                <span className="text-xs text-zinc-400 font-normal">%</span>
              </p>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Thermometer className="w-4 h-4 text-amber-700" />
                </div>
                <span className="text-[10px] font-medium text-zinc-600 bg-zinc-100 rounded-full px-2 py-0.5">
                  {completedCount} visitas
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Lifetime value</p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-900 mt-0.5">
                {fmtMXN(contact.lifetime_value_mxn)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-element animate-delay-200">
            <div className="glass-card p-6 lg:col-span-3">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">Señales vitales</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Últimos 6 meses</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[hsl(235_70%_72%)]" />
                    Sistólica
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[hsl(var(--brand-blue))]" />
                    Diastólica
                  </span>
                </div>
              </div>
              <BloodPressureChart data={bloodPressureData} />
            </div>

            <div className="glass-card p-6 lg:col-span-2">
              <h3 className="text-sm font-semibold text-zinc-900 mb-4">Notas clínicas</h3>
              <div className="space-y-3">
                <div className="rounded-xl bg-zinc-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Tratamiento actual
                  </p>
                  <p className="text-xs text-zinc-800 mt-1 leading-relaxed">
                    {(contact.metadata?.treatment as string) || 'Sin tratamiento activo registrado.'}
                  </p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Alergias
                  </p>
                  <p className="text-xs text-zinc-800 mt-1">
                    {(contact.metadata?.allergies as string) || 'Ninguna reportada'}
                  </p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Temperatura (perfil)
                  </p>
                  <p className="text-xs text-zinc-800 mt-1 capitalize">
                    {contact.lead_temperature || '—'} · Score {contact.lead_score ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card overflow-hidden animate-element animate-delay-300">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-semibold text-zinc-900">Historial de citas</h3>
              </div>
              <span className="text-xs text-zinc-500 tabular-nums">
                {appointments.length} registros
              </span>
            </div>

            {appointments.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">Sin citas registradas.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50/50 text-[10px] uppercase tracking-wider text-zinc-500">
                      <th className="px-6 py-3 text-left font-medium">Fecha</th>
                      <th className="px-6 py-3 text-left font-medium">Servicio</th>
                      <th className="px-6 py-3 text-left font-medium">Doctor</th>
                      <th className="px-6 py-3 text-left font-medium">Notas</th>
                      <th className="px-6 py-3 text-right font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.slice(0, 10).map((a) => (
                      <tr key={a.id} className="border-t border-zinc-100 hover:bg-zinc-50/60 transition">
                        <td className="px-6 py-3.5 text-zinc-900 tabular-nums whitespace-nowrap">
                          {fmtDateTime(a.datetime)}
                        </td>
                        <td className="px-6 py-3.5 text-zinc-700">{a.serviceName}</td>
                        <td className="px-6 py-3.5 text-zinc-700">{a.staffName}</td>
                        <td className="px-6 py-3.5 text-zinc-500 max-w-xs truncate">
                          {a.notes || '—'}
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize',
                              STATUS_STYLES[a.status] ?? 'bg-zinc-100 text-zinc-600',
                            )}
                          >
                            {a.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-zinc-400 text-center">Cliente desde hace {age} años</p>
    </div>
  );
}
