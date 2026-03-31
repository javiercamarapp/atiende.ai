import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getFreeBusySlots, generateAvailableSlots } from '@/lib/calendar/google';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const { staffId, date, duration } = await req.json();

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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
