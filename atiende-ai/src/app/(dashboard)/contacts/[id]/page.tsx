import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft, Phone, Mail, MapPin, Calendar, MoreHorizontal,
  Activity, Heart, Scale, Thermometer, FileText, Download,
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
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtShortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
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
    .select('id, name, phone, email, tags, lead_score, lead_temperature, last_contact_at, health_score, churn_probability, lifetime_value_mxn, next_visit_predicted_at, metadata, created_at')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()) as { data: ContactDetail | null };

  if (!contact) notFound();

  const { data: aptsData } = await supabase
    .from('appointments')
    .select('id, datetime, end_datetime, duration_minutes, status, notes, staff:staff_id(name, speciality), services:service_id(name)')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', contact.phone)
    .order('datetime', { ascending: false })
    .limit(20);

  type AptRow = {
    id: string; datetime: string; end_datetime: string | null; duration_minutes: number | null;
    status: string; notes: string | null;
    staff: { name: string; speciality: string | null } | { name: string; speciality: string | null }[] | null;
    services: { name: string } | { name: string }[] | null;
  };
  const appointments = ((aptsData || []) as unknown as AptRow[]).map((a) => {
    const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
    const svc = Array.isArray(a.services) ? a.services[0] : a.services;
    return {
      id: a.id, datetime: a.datetime, end_datetime: a.end_datetime,
      duration_minutes: a.duration_minutes, status: a.status, notes: a.notes,
      staffName: staff?.name ?? '—', staffSpeciality: staff?.speciality ?? '',
      serviceName: svc?.name ?? '—',
    };
  });

  const completedCount = appointments.filter((a) => a.status === 'completed').length;
  const tags = contact.tags || [];
  const meta = contact.metadata || {};

  const bloodPressureData = [
    { month: 'Ene', top: 120, bottom: -80 },
    { month: 'Feb', top: 118, bottom: -78 },
    { month: 'Mar', top: 125, bottom: -82 },
    { month: 'Abr', top: 122, bottom: -80 },
    { month: 'May', top: 119, bottom: -77 },
    { month: 'Jun', top: 121, bottom: -79 },
    { month: 'Jul', top: 117, bottom: -76 },
    { month: 'Ago', top: 123, bottom: -81 },
    { month: 'Sep', top: 120, bottom: -79 },
    { month: 'Oct', top: 118, bottom: -77 },
    { month: 'Nov', top: 122, bottom: -80 },
    { month: 'Dic', top: 119, bottom: -78 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 animate-element">
        <Link href="/contacts" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          Pacientes
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="text-xs text-zinc-900 font-medium">Detalles del paciente</span>
      </div>

      {/* Top: Patient info card + branded card */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 animate-element animate-delay-100">
        <div className="glass-card p-6 lg:col-span-3">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            <div className="w-20 h-20 rounded-2xl bg-zinc-100 flex items-center justify-center text-2xl font-semibold text-zinc-600 shrink-0">
              {initials(contact.name, contact.phone)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-zinc-900">{contact.name || contact.phone}</h2>
                <span className="text-[10px] font-medium bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] rounded-md px-2 py-0.5">
                  #{contact.id.slice(0, 8).toUpperCase()}
                </span>
                <button className="ml-auto text-zinc-400 hover:text-zinc-600">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {contact.phone}</span>
                {contact.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {contact.email}</span>}
                <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {(meta.address as string) || 'Sin dirección'}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-zinc-100">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Score</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{contact.health_score ?? 0}/100</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Alta</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{fmtShortDate(contact.created_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Temperatura</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5 capitalize">{contact.lead_temperature || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Visitas</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{completedCount}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Churn</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{contact.churn_probability ?? 0}%</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">LTV</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">${(contact.lifetime_value_mxn ?? 0).toLocaleString('es-MX')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Branded patient card */}
        <div className="rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_40%)] p-6 text-white flex flex-col justify-between">
          <div>
            <p className="text-sm font-semibold opacity-80">atiende.ai</p>
          </div>
          <div className="mt-6">
            <p className="text-lg font-semibold">{contact.name || contact.phone}</p>
            <p className="text-xs opacity-70 mt-0.5">#{contact.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>
      </div>

      {/* Vitals cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-element animate-delay-200">
        <div className="glass-card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center mx-auto mb-3">
            <Heart className="w-5 h-5 text-[hsl(var(--brand-blue))]" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Health Score</p>
          <p className="text-2xl font-semibold tabular-nums text-zinc-900 mt-1">{contact.health_score ?? 0}<span className="text-xs text-zinc-400 font-normal">/100</span></p>
        </div>
        <div className="glass-card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center mx-auto mb-3">
            <Scale className="w-5 h-5 text-zinc-700" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Riesgo churn</p>
          <p className="text-2xl font-semibold tabular-nums text-zinc-900 mt-1">{contact.churn_probability ?? 0}<span className="text-xs text-zinc-400 font-normal">%</span></p>
        </div>
        <div className="glass-card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
            <Thermometer className="w-5 h-5 text-amber-700" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Temperatura</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1 capitalize">{contact.lead_temperature || '—'}</p>
        </div>
      </div>

      {/* Medical info + Blood pressure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-element animate-delay-300">
        {/* Blood pressure chart */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-semibold text-zinc-900">Señales vitales</h3>
            </div>
            <p className="text-[11px] text-zinc-500">Último chequeo: <span className="font-medium text-zinc-900">{fmtShortDate(contact.last_contact_at)}</span></p>
          </div>
          <div className="flex items-center gap-4 mb-3 text-[11px] text-zinc-600">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[hsl(235_70%_72%)]" /> Sistólica</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[hsl(var(--brand-blue))]" /> Diastólica</span>
          </div>
          <BloodPressureChart data={bloodPressureData} />
        </div>

        {/* Medical info + Conditions + Allergies */}
        <div className="space-y-4">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-900">Información médica</h3>
              <button className="text-zinc-400 hover:text-zinc-600"><MoreHorizontal className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border border-zinc-100 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Condiciones</p>
                {tags.length > 0 ? (
                  <div className="space-y-1.5">
                    {tags.map((t) => (
                      <div key={t} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                        <span className="text-xs text-zinc-700">{t}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">Ninguna registrada</p>
                )}
              </div>
              <div className="border border-zinc-100 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Alergias</p>
                {(meta.allergies as string) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(meta.allergies as string).split(',').map((a: string) => (
                      <span key={a.trim()} className="inline-flex items-center gap-1 text-xs text-zinc-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--brand-blue))]" />
                        {a.trim()}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">Ninguna reportada</p>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-900">Nota del paciente</h3>
              <button className="text-zinc-400 hover:text-zinc-600"><MoreHorizontal className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              {(meta.treatment as string) || 'Sin notas clínicas registradas para este paciente.'}
            </p>
          </div>
        </div>
      </div>

      {/* Health reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-element animate-delay-300">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-900">Reportes de salud</h3>
            <button className="text-zinc-400 hover:text-zinc-600"><MoreHorizontal className="w-4 h-4" /></button>
          </div>
          <ul className="space-y-2.5">
            {['Reporte general', 'Historial clínico', 'Resultados de laboratorio'].map((doc) => (
              <li key={doc} className="flex items-center justify-between rounded-xl bg-zinc-50 p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-900 truncate">{doc}</p>
                    <p className="text-[10px] text-zinc-400">1.2 MB</p>
                  </div>
                </div>
                <button className="text-zinc-400 hover:text-zinc-600"><Download className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        </div>

        {/* Next appointment */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-900">Próxima cita</h3>
            <Calendar className="w-4 h-4 text-zinc-400" />
          </div>
          {(() => {
            // eslint-disable-next-line react-hooks/purity
            const nowMs = Date.now();
            const upcoming = appointments.find(
              (a) => a.status !== 'cancelled' && new Date(a.datetime).getTime() > nowMs,
            );
            return upcoming ? (
              <div className="rounded-xl bg-[hsl(var(--brand-blue-soft))] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--brand-blue))] font-medium">{upcoming.serviceName}</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{fmtShortDate(upcoming.datetime)} · {fmtTime(upcoming.datetime)}</p>
                <p className="mt-1 text-xs text-zinc-600">Con {upcoming.staffName}</p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-6">Sin cita programada</p>
            );
          })()}
        </div>
      </div>

      {/* Appointments history table */}
      <div className="glass-card overflow-hidden animate-element animate-delay-300">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-900">Citas</h3>
          </div>
          <button className="text-zinc-400 hover:text-zinc-600"><MoreHorizontal className="w-4 h-4" /></button>
        </div>
        {appointments.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500">Sin citas registradas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-3 text-left font-medium">Fecha</th>
                  <th className="px-6 py-3 text-left font-medium">Hora</th>
                  <th className="px-6 py-3 text-left font-medium">Tipo</th>
                  <th className="hidden md:table-cell px-6 py-3 text-left font-medium">Doctor</th>
                  <th className="px-6 py-3 text-left font-medium">Estado</th>
                  <th className="hidden lg:table-cell px-6 py-3 text-left font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {appointments.slice(0, 10).map((a) => {
                  const d = new Date(a.datetime);
                  const endD = a.end_datetime ? new Date(a.end_datetime) : new Date(d.getTime() + (a.duration_minutes || 30) * 60_000);
                  return (
                    <tr key={a.id} className="border-t border-zinc-100 hover:bg-zinc-50/60 transition">
                      <td className="px-6 py-3.5 text-zinc-900 tabular-nums whitespace-nowrap">{fmtShortDate(a.datetime)}</td>
                      <td className="px-6 py-3.5 text-zinc-600 tabular-nums whitespace-nowrap">{fmtTime(a.datetime)} - {fmtTime(endD.toISOString())}</td>
                      <td className="px-6 py-3.5 text-zinc-700">{a.serviceName}</td>
                      <td className="hidden md:table-cell px-6 py-3.5">
                        <p className="text-zinc-900">{a.staffName}</p>
                        <p className="text-[11px] text-zinc-400">{a.staffSpeciality}</p>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize',
                          STATUS_STYLES[a.status] ?? 'bg-zinc-100 text-zinc-600',
                        )}>
                          {a.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell px-6 py-3.5 text-zinc-500 max-w-[200px] truncate">{a.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
