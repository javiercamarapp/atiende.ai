import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listCalendarEvents } from '@/lib/calendar/google';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const maxDuration = 20;
export const runtime = 'nodejs';

const BodySchema = z.object({
  target: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(600).default(30),
  staff_id: z.string().uuid().optional(),
  exclude_appointment_id: z.string().uuid().optional(),
  count: z.number().int().min(1).max(10).default(5),
  window_hours: z.number().int().min(1).max(168).default(48),
  business_start: z.string().default('09:00'),
  business_end: z.string().default('19:00'),
});

interface Busy {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function stepCursor(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

function setTimeOnDate(d: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const next = new Date(d);
  next.setHours(h || 0, m || 0, 0, 0);
  return next;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_suggest`, 60, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 });
    }

    const target = new Date(parsed.data.target);
    if (isNaN(target.getTime())) {
      return NextResponse.json({ error: 'Invalid target date' }, { status: 400 });
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, business_hours')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    // Window: 24h before target, up to window_hours ahead. Cap at sensible size.
    const windowMs = parsed.data.window_hours * 60 * 60 * 1000;
    const searchStart = new Date(Math.max(Date.now(), target.getTime() - 24 * 60 * 60 * 1000));
    const searchEnd = new Date(target.getTime() + windowMs);

    // Gather busy slots: local appointments + Google events
    let localQ = supabaseAdmin
      .from('appointments')
      .select('datetime, end_datetime, duration_minutes, staff_id')
      .eq('tenant_id', tenant.id)
      .in('status', ['scheduled', 'confirmed'])
      .gte('datetime', searchStart.toISOString())
      .lte('datetime', searchEnd.toISOString());
    if (parsed.data.staff_id) localQ = localQ.eq('staff_id', parsed.data.staff_id);
    if (parsed.data.exclude_appointment_id) localQ = localQ.neq('id', parsed.data.exclude_appointment_id);

    const { data: localAppts } = await localQ;

    const busy: Busy[] = ((localAppts || []) as Array<{ datetime: string; end_datetime: string | null; duration_minutes: number | null }>).map((a) => {
      const s = new Date(a.datetime);
      const e = a.end_datetime
        ? new Date(a.end_datetime)
        : new Date(s.getTime() + (a.duration_minutes || 30) * 60000);
      return { start: s, end: e };
    });

    // Google
    const { data: staffList } = await supabaseAdmin
      .from('staff')
      .select('id, google_calendar_id')
      .eq('tenant_id', tenant.id)
      .not('google_calendar_id', 'is', null);

    const staffToQuery = (staffList || []).filter(
      (s) => !parsed.data.staff_id || s.id === parsed.data.staff_id,
    );

    const googleFetches = staffToQuery.map(async (s) => {
      try {
        const events = await listCalendarEvents({
          staffId: s.id,
          calendarId: s.google_calendar_id as string,
          timeMin: searchStart.toISOString(),
          timeMax: searchEnd.toISOString(),
        });
        return events
          .filter((e) => e.status !== 'cancelled' && e.startTime && e.endTime)
          .map((e) => ({ start: new Date(e.startTime!), end: new Date(e.endTime!) }));
      } catch {
        return [];
      }
    });
    const googleBusy = (await Promise.all(googleFetches)).flat();
    busy.push(...googleBusy);

    // Generate candidate slots every 15 minutes between business hours,
    // ranked by distance to the target.
    const step = 15;
    const duration = parsed.data.duration_minutes;
    const biz = tenant.business_hours as Record<string, { open: string; close: string }> | null;
    const candidates: { start: Date; end: Date; distanceMs: number }[] = [];

    for (let day = 0; day <= parsed.data.window_hours / 24 + 1; day++) {
      const dayCursor = new Date(target);
      dayCursor.setDate(dayCursor.getDate() + day - 1);
      const weekdayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dayCursor.getDay()];
      const hours = biz?.[weekdayName] || null;
      const open = hours?.open || parsed.data.business_start;
      const close = hours?.close || parsed.data.business_end;

      let cursor = setTimeOnDate(dayCursor, open);
      const dayClose = setTimeOnDate(dayCursor, close);

      while (cursor < dayClose) {
        const end = stepCursor(cursor, duration);
        if (end > dayClose) break;
        if (cursor < searchStart || cursor > searchEnd) {
          cursor = stepCursor(cursor, step);
          continue;
        }
        const isBusy = busy.some((b) => overlaps(cursor, end, b.start, b.end));
        if (!isBusy) {
          candidates.push({
            start: new Date(cursor),
            end: new Date(end),
            distanceMs: Math.abs(cursor.getTime() - target.getTime()),
          });
        }
        cursor = stepCursor(cursor, step);
      }
    }

    candidates.sort((a, b) => a.distanceMs - b.distanceMs);
    const top = candidates.slice(0, parsed.data.count).map((c) => ({
      start: c.start.toISOString(),
      end: c.end.toISOString(),
    }));

    return NextResponse.json({ suggestions: top });
  } catch (err) {
    console.error('[api/appt/suggest-slots] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
