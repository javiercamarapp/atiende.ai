import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar/google';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 30;
export const runtime = 'nodejs';

const PatchSchema = z.object({
  customer_name: z.string().trim().min(1).max(200).optional(),
  customer_phone: z.string().trim().min(1).max(40).optional(),
  service_name: z.string().trim().max(200).optional(),
  duration_minutes: z.number().int().min(5).max(600).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_patch`, 60, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 });
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

    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select(
        'id, tenant_id, staff_id, service_id, datetime, end_datetime, duration_minutes, customer_name, customer_phone, notes, google_event_id, staff:staff_id(google_calendar_id)',
      )
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // Resolve service id by name if given
    let newServiceId: string | null | undefined = undefined;
    let newServiceName: string | undefined = undefined;
    if (parsed.data.service_name !== undefined) {
      const { data: svc } = await supabaseAdmin
        .from('services')
        .select('id, name, duration_minutes')
        .eq('tenant_id', tenant.id)
        .ilike('name', parsed.data.service_name)
        .limit(1)
        .maybeSingle();
      if (svc) {
        newServiceId = svc.id as string;
        newServiceName = svc.name as string;
      } else {
        newServiceId = null; // clear
        newServiceName = parsed.data.service_name;
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.customer_name !== undefined) updates.customer_name = parsed.data.customer_name;
    if (parsed.data.customer_phone !== undefined) updates.customer_phone = parsed.data.customer_phone;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (newServiceId !== undefined) updates.service_id = newServiceId;

    // Duration change => recompute end_datetime
    if (parsed.data.duration_minutes !== undefined) {
      updates.duration_minutes = parsed.data.duration_minutes;
      const startMs = new Date(apt.datetime as string).getTime();
      updates.end_datetime = new Date(startMs + parsed.data.duration_minutes * 60000).toISOString();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, noop: true });
    }

    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update(updates)
      .eq('id', apt.id);

    if (updErr) {
      logger.error('[api/appt/patch] DB update failed', new Error(updErr.message), { appointment_id: id });
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    // Mirror to Google Calendar (summary + description + optional end)
    let calendarSynced = false;
    if (apt.google_event_id) {
      const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
      const calendarId = (staffRel as { google_calendar_id: string | null } | null)?.google_calendar_id;
      if (calendarId) {
        try {
          const finalName =
            parsed.data.customer_name ?? (apt.customer_name as string | null) ?? 'Paciente';
          const finalPhone =
            parsed.data.customer_phone ?? (apt.customer_phone as string);
          const finalNotes =
            parsed.data.notes !== undefined ? parsed.data.notes : (apt.notes as string | null);
          const finalService = newServiceName || 'Cita';

          await updateCalendarEvent({
            staffId: apt.staff_id as string,
            calendarId,
            eventId: apt.google_event_id as string,
            summary: `${finalService} - ${finalName}`,
            description:
              `Paciente: ${finalName}\n` +
              `Tel: ${finalPhone}` +
              (finalNotes ? `\nNotas: ${finalNotes}` : ''),
            endTime: updates.end_datetime as string | undefined,
            timezone: (tenant.timezone as string) || 'America/Merida',
          });
          calendarSynced = true;
        } catch (err) {
          logger.warn('[api/appt/patch] Google update failed', {
            error: err instanceof Error ? err.message : String(err),
            appointment_id: id,
          });
        }
      }
    }

    return NextResponse.json({ ok: true, calendarSynced });
  } catch (err) {
    logger.error(
      '[api/appointments/[id] PATCH] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
