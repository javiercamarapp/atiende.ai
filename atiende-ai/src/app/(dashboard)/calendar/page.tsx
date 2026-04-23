import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { CalendarView } from '@/components/dashboard/calendar-view';
import { CalendarOnboarding } from '@/components/dashboard/calendar-onboarding';
import { createServerSupabase } from '@/lib/supabase/server';

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
}

interface ServiceOption {
  id: string;
  name: string;
  category: string | null;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; calendar?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const month = params.month ? parseInt(params.month, 10) - 1 : now.getMonth();
  const year = params.year ? parseInt(params.year, 10) : now.getFullYear();
  const justConnected = params.calendar === 'connected';

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

  const { count: connectedStaffCount } = await supabase
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .not('google_calendar_id', 'is', null);

  if (!connectedStaffCount || connectedStaffCount === 0) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center animate-element">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shadow-lg shadow-[hsl(var(--brand-blue))]/20">
            <CalendarDays className="w-8 h-8 text-white" />
          </div>
          <h1 className="mt-6 text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900">
            Conecta tu Google Calendar
          </h1>
          <p className="mt-3 text-sm md:text-[15px] text-zinc-500 leading-relaxed">
            Sincroniza tus citas automáticamente con Google Calendar para tener todo en un solo lugar.
          </p>
          <Link
            href="/api/calendar/connect"
            className="mt-7 inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full bg-[hsl(var(--brand-blue))] text-white text-sm font-medium hover:opacity-90 transition shadow-md shadow-[hsl(var(--brand-blue))]/20"
          >
            <CalendarDays className="w-4 h-4" />
            Conectar Google Calendar
          </Link>
        </div>
      </div>
    );
  }

  const { data: aptsRaw } = await supabase
    .from('appointments')
    .select(
      'id, datetime, end_datetime, status, customer_name, customer_phone, notes, staff:staff_id(name), services:service_id(name)',
    )
    .eq('tenant_id', tenant.id)
    .gte('datetime', start.toISOString())
    .lt('datetime', end.toISOString())
    .order('datetime', { ascending: true })
    .limit(800);

  const { data: servicesRaw } = await supabase
    .from('services')
    .select('id, name, category')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('name', { ascending: true });

  type AptRow = {
    id: string;
    datetime: string;
    end_datetime: string | null;
    status: string;
    customer_name: string | null;
    customer_phone: string;
    notes: string | null;
    staff: { name: string } | { name: string }[] | null;
    services: { name: string } | { name: string }[] | null;
  };

  const events: CalendarEvent[] = ((aptsRaw || []) as unknown as AptRow[]).map((a) => {
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
    };
  });

  const services: ServiceOption[] = (servicesRaw || []) as ServiceOption[];

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <CalendarOnboarding autoOpen={justConnected} />
      <CalendarView events={events} services={services} initialYear={year} initialMonth={month} />
    </div>
  );
}
