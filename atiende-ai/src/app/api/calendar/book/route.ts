import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar/google';
import { createServerSupabase } from '@/lib/supabase/server';

// Google Calendar round-trip + DB insert. 30s is safe headroom over Pro's 15s.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: authTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!authTenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const tenantId = authTenant.id;
    const { staffId, serviceId, customerName, customerPhone,
            datetime, durationMinutes, source } = await req.json();

    // Obtener info del staff y tenant
    const { data: staff } = await supabaseAdmin.from('staff').select('name, google_calendar_id')
      .eq('id', staffId).single();
    const { data: tenant } = await supabaseAdmin.from('tenants').select('name, timezone')
      .eq('id', tenantId).single();
    const { data: service } = await supabaseAdmin.from('services').select('name')
      .eq('id', serviceId).single();

    // Crear cita en DB
    const endTime = new Date(new Date(datetime).getTime() + durationMinutes * 60000).toISOString();
    let googleEventId = null;

    // Sync con Google Calendar si el staff tiene calendar ID
    if (staff?.google_calendar_id) {
      try {
        const event = await createCalendarEvent({
          staffId,
          calendarId: staff.google_calendar_id,
          summary: `${service?.name || 'Cita'} - ${customerName || customerPhone}`,
          description: `Paciente: ${customerName}\nTel: ${customerPhone}\nServicio: ${service?.name}\nAgendada via: ${source}\n\nAgendada por useatiende.ai`,
          startTime: datetime,
          endTime,
          timezone: tenant?.timezone || 'America/Merida',
        });
        googleEventId = event.eventId;
      } catch (e) {
        console.error('Google Calendar sync failed:', e);
        // La cita se crea de todas formas en DB
      }
    }

    const { data: appointment } = await supabaseAdmin.from('appointments').insert({
      tenant_id: tenantId, staff_id: staffId, service_id: serviceId,
      customer_name: customerName, customer_phone: customerPhone,
      datetime, duration_minutes: durationMinutes,
      status: 'scheduled', source,
      google_event_id: googleEventId,
    }).select().single();

    return NextResponse.json({ appointment });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
