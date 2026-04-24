import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar/google';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 30;
export const runtime = 'nodejs';

const BodySchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  label: z.string().trim().min(1).max(200).default('Bloqueo'),
  staff_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:cal_block`, 30, 60)) {
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

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, timezone')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    // Pick staff with google_calendar_id connected
    let staffQuery = supabaseAdmin
      .from('staff')
      .select('id, name, google_calendar_id')
      .eq('tenant_id', tenant.id)
      .not('google_calendar_id', 'is', null);
    if (parsed.data.staff_id) {
      staffQuery = staffQuery.eq('id', parsed.data.staff_id);
    }
    const { data: staff } = await staffQuery.order('created_at', { ascending: true }).limit(1).maybeSingle();

    if (!staff?.google_calendar_id) {
      return NextResponse.json({ error: 'No connected staff calendar' }, { status: 400 });
    }

    try {
      const ev = await createCalendarEvent({
        staffId: staff.id as string,
        calendarId: staff.google_calendar_id as string,
        summary: `🚫 ${parsed.data.label}`,
        description: 'Horario bloqueado desde atiende.ai — no disponible para citas.',
        startTime: parsed.data.start,
        endTime: parsed.data.end,
        timezone: (tenant.timezone as string) || 'America/Merida',
      });
      return NextResponse.json({ ok: true, eventId: ev.eventId });
    } catch (err) {
      logger.error(
        '[api/calendar/block] Google event create failed',
        err instanceof Error ? err : new Error(String(err)),
        { tenant_id: tenant.id, staff_id: staff.id },
      );
      return NextResponse.json({ error: 'Failed to create blocker event' }, { status: 500 });
    }
  } catch (err) {
    logger.error(
      '[api/calendar/block] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
