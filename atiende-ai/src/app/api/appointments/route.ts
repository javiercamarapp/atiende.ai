import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar/google';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

// Google Calendar round-trip + DB insert. 30s headroom.
export const maxDuration = 30;
export const runtime = 'nodejs';

const BodySchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  customer_phone: z.string().trim().min(1).max(40).default('—'),
  service_name: z.string().trim().max(200).optional().default(''),
  datetime: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(600).optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Recurring: creates N - 1 additional copies spaced weekly (7 days).
  // Use repeat_weeks >= 2 to generate a series. Max 52 (one year).
  repeat_weeks: z.number().int().min(1).max(52).optional().default(1),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appointments_create`, 30, 60)) {
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

    const { customer_name, customer_phone, service_name, datetime, notes } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, timezone')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    // Pick the first staff of this tenant (with google calendar preferred so
    // the event actually syncs). Fall back to any staff.
    const { data: preferredStaff } = await supabaseAdmin
      .from('staff')
      .select('id, name, default_duration, google_calendar_id')
      .eq('tenant_id', tenant.id)
      .not('google_calendar_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let staff = preferredStaff as
      | { id: string; name: string; default_duration: number | null; google_calendar_id: string | null }
      | null;

    if (!staff) {
      const { data: anyStaff } = await supabaseAdmin
        .from('staff')
        .select('id, name, default_duration, google_calendar_id')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      staff = anyStaff as typeof staff;
    }

    if (!staff) {
      return NextResponse.json({ error: 'No staff configured for tenant' }, { status: 400 });
    }

    // Resolve service by name (optional; walk-ins can skip).
    let serviceId: string | null = null;
    let serviceNameResolved = service_name || 'Consulta';
    let durationMinutes = parsed.data.duration_minutes || staff.default_duration || 30;
    if (service_name) {
      const { data: svc } = await supabaseAdmin
        .from('services')
        .select('id, name, duration_minutes')
        .eq('tenant_id', tenant.id)
        .ilike('name', service_name)
        .limit(1)
        .maybeSingle();
      if (svc) {
        serviceId = svc.id as string;
        serviceNameResolved = (svc.name as string) || serviceNameResolved;
        durationMinutes = (svc.duration_minutes as number) || durationMinutes;
      }
    }

    // Build the series of occurrences (1 = single appointment; N > 1 = weekly)
    const repeatWeeks = parsed.data.repeat_weeks || 1;
    const occurrences: { start: string; end: string }[] = Array.from({ length: repeatWeeks }, (_, i) => {
      const offsetMs = i * 7 * 24 * 60 * 60 * 1000;
      const start = new Date(new Date(datetime).getTime() + offsetMs).toISOString();
      const end = new Date(new Date(start).getTime() + durationMinutes * 60000).toISOString();
      return { start, end };
    });

    // Generate a recurrence_group_id so downstream tooling can find the series.
    const recurrenceGroupId = repeatWeeks > 1 ? crypto.randomUUID() : null;

    const createdRows: Array<{ id: string; google_event_id: string | null; datetime: string }> = [];
    let googleFailures = 0;

    for (let i = 0; i < occurrences.length; i++) {
      const occ = occurrences[i];
      let googleEventId: string | null = null;

      if (staff.google_calendar_id) {
        try {
          const seriesLabel = repeatWeeks > 1 ? ` (${i + 1}/${repeatWeeks})` : '';
          const ev = await createCalendarEvent({
            staffId: staff.id,
            calendarId: staff.google_calendar_id,
            summary: `${serviceNameResolved} - ${customer_name}${seriesLabel}`,
            description:
              `Agendada desde atiende.ai\n` +
              `Paciente: ${customer_name}\n` +
              `Tel: ${customer_phone}` +
              (notes ? `\nNotas: ${notes}` : '') +
              (recurrenceGroupId ? `\nSerie: ${recurrenceGroupId}` : ''),
            startTime: occ.start,
            endTime: occ.end,
            timezone: (tenant.timezone as string) || 'America/Merida',
          });
          googleEventId = ev.eventId;
        } catch (err) {
          googleFailures++;
          logger.error(
            '[api/appointments] Google Calendar sync failed',
            err instanceof Error ? err : new Error(String(err)),
            { tenant_id: tenant.id, staff_id: staff.id, occurrence_index: i },
          );
        }
      }

      const payload: Record<string, unknown> = {
        tenant_id: tenant.id,
        staff_id: staff.id,
        service_id: serviceId,
        customer_name,
        customer_phone,
        datetime: occ.start,
        end_datetime: occ.end,
        duration_minutes: durationMinutes,
        status: 'scheduled',
        source: 'web',
        google_event_id: googleEventId,
        notes: notes ?? null,
      };
      if (recurrenceGroupId) payload.recurrence_group_id = recurrenceGroupId;

      let { data: appointment, error: insertErr } = await supabaseAdmin
        .from('appointments')
        .insert(payload)
        .select('id, google_event_id, datetime')
        .single();

      // Retry without recurrence_group_id if the column isn't present yet.
      if (insertErr && recurrenceGroupId && /recurrence_group_id/.test(insertErr.message || '')) {
        delete payload.recurrence_group_id;
        ({ data: appointment, error: insertErr } = await supabaseAdmin
          .from('appointments')
          .insert(payload)
          .select('id, google_event_id, datetime')
          .single());
      }

      if (insertErr) {
        logger.error(
          '[api/appointments] DB insert failed',
          new Error(insertErr.message),
          { tenant_id: tenant.id, occurrence_index: i },
        );
        if (i === 0) {
          return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
        }
        // Skip this occurrence, keep going.
        continue;
      }

      if (appointment) createdRows.push(appointment);
    }

    return NextResponse.json({
      appointment: createdRows[0] ?? null,
      created_count: createdRows.length,
      recurrence_group_id: recurrenceGroupId,
      google_failures: googleFailures,
    });
  } catch (err) {
    logger.error(
      '[api/appointments] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
