import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar/google';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 30;
export const runtime = 'nodejs';

const BodySchema = z.object({
  new_datetime: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(600).optional(),
  reason: z.string().trim().max(300).optional(),
  notify_customer: z.boolean().optional().default(true),
});

function formatDateTimeMx(iso: string, timezone = 'America/Merida') {
  const d = new Date(iso);
  const dateFmt = d.toLocaleDateString('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeFmt = d.toLocaleTimeString('es-MX', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return { dateFmt, timeFmt };
}

export async function POST(
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

    if (await checkApiRateLimit(`${user.id}:appt_reschedule`, 30, 60)) {
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
    const { new_datetime, reason, notify_customer } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, timezone, wa_phone_number_id')
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
        'id, tenant_id, staff_id, service_id, datetime, duration_minutes, status, customer_name, customer_phone, google_event_id, staff:staff_id(google_calendar_id), services:service_id(name)',
      )
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (apt.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot reschedule a cancelled appointment' }, { status: 400 });
    }

    const oldDatetime = apt.datetime as string;
    const duration = parsed.data.duration_minutes ?? (apt.duration_minutes as number | null) ?? 30;
    const newEnd = new Date(new Date(new_datetime).getTime() + duration * 60000).toISOString();

    // 1. Patch Google Calendar event (keeps the same event id + attendees)
    let calendarSynced = false;
    if (apt.google_event_id) {
      const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
      const calendarId = (staffRel as { google_calendar_id: string | null } | null)?.google_calendar_id;
      if (calendarId) {
        try {
          await updateCalendarEvent({
            staffId: apt.staff_id as string,
            calendarId,
            eventId: apt.google_event_id as string,
            startTime: new_datetime,
            endTime: newEnd,
            timezone: (tenant.timezone as string) || 'America/Merida',
          });
          calendarSynced = true;
        } catch (err) {
          logger.warn('[api/appt/reschedule] Google patch failed', {
            error: err instanceof Error ? err.message : String(err),
            appointment_id: id,
          });
        }
      }
    }

    // 2. DB update
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        datetime: new_datetime,
        end_datetime: newEnd,
        duration_minutes: duration,
        status: 'scheduled',
      })
      .eq('id', apt.id);

    if (updErr) {
      logger.error('[api/appt/reschedule] DB update failed', new Error(updErr.message), {
        appointment_id: id,
      });
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    // 3. Notify patient via WhatsApp
    let customerNotified = false;
    let notifyError: string | undefined;
    if (notify_customer && tenant.wa_phone_number_id && apt.customer_phone) {
      const tz = (tenant.timezone as string) || 'America/Merida';
      const oldFmt = formatDateTimeMx(oldDatetime, tz);
      const newFmt = formatDateTimeMx(new_datetime, tz);
      const serviceName = (() => {
        const s = Array.isArray(apt.services) ? apt.services[0] : apt.services;
        return (s as { name?: string } | null)?.name || 'su cita';
      })();

      const body =
        `Hola${apt.customer_name ? ` ${apt.customer_name}` : ''} 👋\n\n` +
        `Le escribo de ${tenant.name} para reagendar ${serviceName}.\n\n` +
        `Antes: *${oldFmt.dateFmt}* a las *${oldFmt.timeFmt}*\n` +
        `Ahora: *${newFmt.dateFmt}* a las *${newFmt.timeFmt}*` +
        (reason ? `\n\nMotivo: ${reason}` : '') +
        `\n\n¿Le acomoda este nuevo horario?\n` +
        `• Responda *SÍ* para confirmar\n` +
        `• O propóngame otra fecha/hora si no le funciona\n` +
        `• Escriba *cancelar* si ya no puede asistir\n\n` +
        `Disculpe las molestias.`;

      const res = await sendTextMessage(
        tenant.wa_phone_number_id as string,
        apt.customer_phone as string,
        body,
      );
      customerNotified = res.ok;
      if (!res.ok) notifyError = res.errorLabel || `http_${res.errorCode ?? 'unknown'}`;
    }

    // 4. Marketplace event
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.rescheduled_by_staff', {
        tenant_id: tenant.id,
        appointment_id: apt.id,
        old_datetime: oldDatetime,
        new_datetime,
      });
    } catch {
      /* best effort */
    }

    return NextResponse.json({
      ok: true,
      calendarSynced,
      customerNotified,
      notifyError,
    });
  } catch (err) {
    logger.error(
      '[api/appointments/[id]/reschedule] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
