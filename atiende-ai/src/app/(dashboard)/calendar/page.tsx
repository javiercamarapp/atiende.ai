import Link from 'next/link';
import { CalendarDays, Sparkles, Clock, MessageSquare } from 'lucide-react';
import { CalendarView } from '@/components/dashboard/calendar-view';
import { CalendarOnboarding } from '@/components/dashboard/calendar-onboarding';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listCalendarEvents } from '@/lib/calendar/google';

// Revalidate this route every 60s so Google-only events surface quickly
// without making every navigation wait for the Google API roundtrip.
export const revalidate = 60;

interface CalendarEvent {
  id: string;
  datetime: string;
  end_datetime: string | null;
  status: string;
  customer_name: string | null;
  customer_phone: string;
  notes: string | null;
  staffName: string;
  serviceName: string;
  source?: 'local' | 'google';
}

interface ServiceOption {
  id: string;
  name: string;
  category: string | null;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; calendar?: string; calendar_error?: string; detail?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const month = params.month ? parseInt(params.month, 10) - 1 : now.getMonth();
  const year = params.year ? parseInt(params.year, 10) : now.getFullYear();
  const justConnected = params.calendar === 'connected';
  const connectError = params.calendar_error || null;
  const connectErrorDetail = params.detail || null;

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month + 2, 1);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, business_type, plan')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) return <div>No tenant found</div>;

  // Bypass RLS for the count — we already validated tenant ownership above.
  const { count: connectedStaffCount } = await supabaseAdmin
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .not('google_calendar_id', 'is', null);

  if (!connectedStaffCount || connectedStaffCount === 0) {
    const features = [
      { icon: Sparkles, title: 'Sincronización bidireccional', body: 'Las citas que agendamos vía WhatsApp aparecen en tu calendario al instante, y los bloqueos que pongas en Google se respetan.' },
      { icon: Clock, title: 'Recordatorios automáticos', body: '24 h y 2 h antes de cada cita, enviamos recordatorio por WhatsApp con opción a confirmar o reagendar.' },
      { icon: MessageSquare, title: 'La IA agenda por ti', body: 'El bot revisa tu disponibilidad real en Google antes de proponer horarios. Sin doble-booking.' },
    ];
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-8">
        <div className="max-w-xl w-full">
          {connectError && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 animate-element">
              <p className="text-[13px] font-semibold text-amber-900">
                No pudimos completar la conexión con Google Calendar
              </p>
              <p className="text-[12px] text-amber-800 mt-1">
                Motivo: <code className="font-mono">{connectError}</code>
                {connectErrorDetail && (
                  <>
                    {' — '}
                    <span>{connectErrorDetail}</span>
                  </>
                )}
              </p>
              <p className="text-[11.5px] text-amber-700 mt-2">
                {connectError === 'no_refresh_token' &&
                  'Revoca el acceso en Google (myaccount.google.com/permissions), vuelve aquí y conecta otra vez.'}
                {connectError === 'unauthorized' && 'Tu sesión expiró durante el flujo. Vuelve a iniciar sesión y conecta de nuevo.'}
                {connectError === 'invalid_state' && 'Hubo un problema con los cookies. Desactiva el bloqueo de cookies de terceros para app.useatiende.ai y reintenta.'}
                {connectError === 'env_missing' && 'Faltan variables de entorno en Vercel. Contacta a soporte.'}
                {(connectError === 'db_update_failed' || connectError === 'db_insert_failed') && 'Error guardando la conexión en DB. Contacta a soporte con el detalle de arriba.'}
                {connectError === 'calendar_failed' && 'Error inesperado. Reintenta o contacta soporte con el detalle de arriba.'}
              </p>
            </div>
          )}

          {/* Hero */}
          <div className="relative text-center animate-element">
            <div aria-hidden className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue-soft))] to-transparent blur-3xl opacity-70" />
            </div>
            <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shadow-xl shadow-[hsl(var(--brand-blue))]/25 animate-float">
              <CalendarDays className="w-10 h-10 text-white" strokeWidth={1.75} />
            </div>
            <h1 className="mt-7 text-3xl md:text-[40px] font-semibold tracking-tight text-zinc-900 leading-[1.05]">
              Conecta tu Google Calendar
            </h1>
            <p className="mt-4 text-[15px] md:text-base text-zinc-500 leading-relaxed max-w-md mx-auto">
              Sincroniza tus citas de WhatsApp con Google Calendar. Configuración en 30 segundos, sin pasos adicionales.
            </p>
            <Link
              href="/api/calendar/connect"
              className="mt-8 group inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-full bg-zinc-900 text-white text-[14px] font-medium hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 hover:shadow-xl hover:shadow-zinc-900/20 hover:-translate-y-0.5"
            >
              <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden>
                <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Conectar con Google
              <span aria-hidden className="opacity-60 transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <p className="mt-4 text-[11.5px] text-zinc-400">
              Solo pedimos acceso a tu calendario. Puedes revocar el acceso en cualquier momento desde Google.
            </p>
          </div>

          {/* Feature grid */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="animate-element glass-card p-4 text-left"
                  style={{ animationDelay: `${150 + i * 100}ms` }}
                >
                  <div className="w-8 h-8 rounded-lg bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="mt-3 text-[13px] font-semibold text-zinc-900">{f.title}</p>
                  <p className="mt-1 text-[11.5px] text-zinc-500 leading-snug">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Fetch local appointments, services, and connected staff in parallel.
  const [aptsRes, servicesRes, staffRes] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        'id, datetime, end_datetime, status, customer_name, customer_phone, notes, google_event_id, staff:staff_id(name), services:service_id(name)',
      )
      .eq('tenant_id', tenant.id)
      .gte('datetime', start.toISOString())
      .lt('datetime', end.toISOString())
      .order('datetime', { ascending: true })
      .limit(800),
    supabase
      .from('services')
      .select('id, name, category')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('staff')
      .select('id, name, google_calendar_id')
      .eq('tenant_id', tenant.id)
      .not('google_calendar_id', 'is', null),
  ]);
  const aptsRaw = aptsRes.data;
  const servicesRaw = servicesRes.data;
  const connectedStaff = staffRes.data as Array<{ id: string; name: string; google_calendar_id: string }> | null;

  type AptRow = {
    id: string;
    datetime: string;
    end_datetime: string | null;
    status: string;
    customer_name: string | null;
    customer_phone: string;
    notes: string | null;
    google_event_id: string | null;
    staff: { name: string } | { name: string }[] | null;
    services: { name: string } | { name: string }[] | null;
  };

  const localEvents: CalendarEvent[] = ((aptsRaw || []) as unknown as AptRow[]).map((a) => {
    const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
    const svc = Array.isArray(a.services) ? a.services[0] : a.services;
    return {
      id: a.id,
      datetime: a.datetime,
      end_datetime: a.end_datetime,
      status: a.status,
      customer_name: a.customer_name,
      customer_phone: a.customer_phone,
      notes: a.notes,
      staffName: staff?.name ?? '—',
      serviceName: svc?.name ?? 'Consulta',
      source: 'local',
    };
  });

  // Pull Google Calendar events for each connected staff and merge.
  // Local appointments that already have a google_event_id are authoritative;
  // Google events without a local counterpart are surfaced as external.
  const localGoogleIds = new Set(
    ((aptsRaw || []) as unknown as AptRow[])
      .map((a) => a.google_event_id)
      .filter((v): v is string => !!v),
  );

  const googleEventsFetches = (connectedStaff || []).map(async (staff) => {
    try {
      const events = await listCalendarEvents({
        staffId: staff.id,
        calendarId: staff.google_calendar_id,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
      });
      return events.map((e) => ({ ...e, staffName: staff.name }));
    } catch (err) {
      console.warn('[calendar-page] Google events fetch failed for staff', staff.id, err);
      return [];
    }
  });

  const googleEventsByStaff = await Promise.all(googleEventsFetches);
  const externalEvents: CalendarEvent[] = googleEventsByStaff
    .flat()
    .filter((e) => !localGoogleIds.has(e.id) && e.status !== 'cancelled' && e.startTime)
    .map((e) => ({
      id: `google-${e.id}`,
      datetime: e.startTime!,
      end_datetime: e.endTime,
      status: 'scheduled',
      customer_name: null,
      customer_phone: '',
      notes: e.description,
      staffName: e.staffName,
      serviceName: e.summary,
      source: 'google' as const,
    }));

  const events: CalendarEvent[] = [...localEvents, ...externalEvents].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );

  const services: ServiceOption[] = (servicesRaw || []) as ServiceOption[];

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <CalendarOnboarding autoOpen={justConnected} />
      <CalendarView events={events} services={services} initialYear={year} initialMonth={month} />
    </div>
  );
}
