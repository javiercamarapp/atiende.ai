import { CalendarView } from '@/components/dashboard/calendar-view';
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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const month = params.month ? parseInt(params.month, 10) - 1 : now.getMonth();
  const year = params.year ? parseInt(params.year, 10) : now.getFullYear();

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 2, 1);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, business_type')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) return <div>No tenant found</div>;

  const { data: aptsRaw } = await supabase
    .from('appointments')
    .select(
      'id, datetime, end_datetime, status, customer_name, customer_phone, notes, staff:staff_id(name), services:service_id(name)',
    )
    .eq('tenant_id', tenant.id)
    .gte('datetime', start.toISOString())
    .lt('datetime', end.toISOString())
    .order('datetime', { ascending: true })
    .limit(400);

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

  return <CalendarView events={events} initialYear={year} initialMonth={month} />;
}
