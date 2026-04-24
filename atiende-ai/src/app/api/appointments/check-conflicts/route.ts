import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listCalendarEvents } from '@/lib/calendar/google';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const maxDuration = 20;
export const runtime = 'nodejs';

const BodySchema = z.object({
  staff_id: z.string().uuid().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  exclude_appointment_id: z.string().uuid().optional(),
});

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_conflicts`, 60, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { start, end, exclude_appointment_id } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const startDt = new Date(start);
    const endDt = new Date(end);

    // Local appointments that overlap
    let localQ = supabaseAdmin
      .from('appointments')
      .select('id, datetime, end_datetime, duration_minutes, customer_name, staff:staff_id(name, google_calendar_id)')
      .eq('tenant_id', tenant.id)
      .in('status', ['scheduled', 'confirmed'])
      .lt('datetime', endDt.toISOString())
      .gte('datetime', new Date(startDt.getTime() - 6 * 60 * 60 * 1000).toISOString());
    if (parsed.data.staff_id) localQ = localQ.eq('staff_id', parsed.data.staff_id);
    if (exclude_appointment_id) localQ = localQ.neq('id', exclude_appointment_id);

    const { data: localAppts } = await localQ;

    type LocalRow = {
      id: string; datetime: string; end_datetime: string | null; duration_minutes: number | null;
      customer_name: string | null;
      staff: { name: string; google_calendar_id: string | null } | { name: string; google_calendar_id: string | null }[] | null;
    };

    const localConflicts = ((localAppts || []) as unknown as LocalRow[])
      .map((a) => {
        const aStart = new Date(a.datetime);
        const aEnd = a.end_datetime
          ? new Date(a.end_datetime)
          : new Date(aStart.getTime() + (a.duration_minutes || 30) * 60000);
        return { ...a, aStart, aEnd };
      })
      .filter((a) => overlaps(a.aStart, a.aEnd, startDt, endDt))
      .map((a) => {
        const s = Array.isArray(a.staff) ? a.staff[0] : a.staff;
        return {
          source: 'local' as const,
          id: a.id,
          title: a.customer_name || 'Cita',
          start: a.aStart.toISOString(),
          end: a.aEnd.toISOString(),
          staffName: s?.name || null,
        };
      });

    // Google Calendar events in that window for each connected staff
    const { data: connectedStaff } = await supabaseAdmin
      .from('staff')
      .select('id, name, google_calendar_id')
      .eq('tenant_id', tenant.id)
      .not('google_calendar_id', 'is', null);

    const googleFetches = (connectedStaff || [])
      .filter((s) => !parsed.data.staff_id || s.id === parsed.data.staff_id)
      .map(async (staff) => {
        try {
          const events = await listCalendarEvents({
            staffId: staff.id,
            calendarId: staff.google_calendar_id as string,
            timeMin: new Date(startDt.getTime() - 60 * 60 * 1000).toISOString(),
            timeMax: new Date(endDt.getTime() + 60 * 60 * 1000).toISOString(),
          });
          return events.map((e) => ({ ...e, staffName: staff.name }));
        } catch {
          return [];
        }
      });

    const googleEvents = (await Promise.all(googleFetches)).flat();
    const localGoogleIds = new Set(
      ((localAppts || []) as Array<{ id: string }>)
        .map((a) => (a as unknown as { google_event_id?: string }).google_event_id)
        .filter((v): v is string => !!v),
    );

    const googleConflicts = googleEvents
      .filter((e) => !localGoogleIds.has(e.id) && e.status !== 'cancelled' && e.startTime && e.endTime)
      .map((e) => ({
        start: new Date(e.startTime!),
        end: new Date(e.endTime!),
        raw: e,
      }))
      .filter((e) => overlaps(e.start, e.end, startDt, endDt))
      .map((e) => ({
        source: 'google' as const,
        id: e.raw.id,
        title: e.raw.summary,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        staffName: e.raw.staffName,
      }));

    const conflicts = [...localConflicts, ...googleConflicts].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    return NextResponse.json({ conflicts });
  } catch (err) {
    console.error('[api/appt/check-conflicts] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
