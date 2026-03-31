import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar/google';

export async function POST(req: NextRequest) {
  const { tenantId, staffId, serviceId, customerName, customerPhone,
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
        calendarId: staff.google_calendar_id,
        summary: `${service?.name || 'Cita'} - ${customerName || customerPhone}`,
        description: `Paciente: ${customerName}\nTel: ${customerPhone}\nServicio: ${service?.name}\nAgendada via: ${source}\n\nAgendada por atiende.ai`,
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
}
