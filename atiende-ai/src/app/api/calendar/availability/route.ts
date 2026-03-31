import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getFreeBusySlots, generateAvailableSlots } from '@/lib/calendar/google';

export async function POST(req: NextRequest) {
  const { tenantId, staffId, date, duration } = await req.json();

  // Obtener calendar ID del staff
  const { data: staff } = await supabaseAdmin
    .from('staff').select('google_calendar_id, schedule')
    .eq('id', staffId).single();

  if (!staff?.google_calendar_id) {
    // Sin Google Calendar → generar slots basados en horario manual
    const hours = staff?.schedule?.[new Date(date).getDay()] || { open: '09:00', close: '18:00' };
    const slots = generateAvailableSlots({ date, businessHours: hours, duration, busySlots: [] });
    return NextResponse.json({ slots });
  }

  // Con Google Calendar → verificar disponibilidad real
  const startDate = `${date}T00:00:00-06:00`;
  const endDate = `${date}T23:59:59-06:00`;
  const busySlots = await getFreeBusySlots({
    calendarId: staff.google_calendar_id, startDate, endDate,
  });

  const hours2 = staff.schedule?.[new Date(date).getDay()] || { open: '09:00', close: '18:00' };
  const slots = generateAvailableSlots({
    date, businessHours: hours2, duration, busySlots, padding: 15,
  });

  return NextResponse.json({ slots });
}
