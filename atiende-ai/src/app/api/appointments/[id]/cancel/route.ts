import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cancelCalendarEvent } from '@/lib/calendar/google';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 30;
export const runtime = 'nodejs';

const BodySchema = z.object({
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_cancel`, 30, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 });
    }
    const { reason, notify_customer } = parsed.data;

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

    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select(
        'id, tenant_id, staff_id, datetime, status, customer_name, customer_phone, google_event_id, staff:staff_id(google_calendar_id)',
      )
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (readErr || !apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (apt.status === 'cancelled') {
      return NextResponse.json({ ok: true, alreadyCancelled: true });
    }

    // 1. Google Calendar — cancel the event if present
    let calendarDeleted = false;
    if (apt.google_event_id) {
      const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
      const calendarId = (staffRel as { google_calendar_id: string | null } | null)?.google_calendar_id;
      if (calendarId) {
        try {
          await cancelCalendarEvent(calendarId, apt.google_event_id as string, apt.staff_id as string);
          calendarDeleted = true;
        } catch (err) {
          logger.warn('[api/appt/cancel] Google cancel failed', {
            error: err instanceof Error ? err.message : String(err),
            appointment_id: id,
          });
        }
      }
    }

    // 2. DB — mark cancelled
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cancellation_reason: reason ?? null,
      })
      .eq('id', apt.id);

    if (updErr) {
      // Column cancellation_reason may not exist — retry without it.
      const { error: retryErr } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', apt.id);
      if (retryErr) {
        logger.error('[api/appt/cancel] DB update failed', new Error(retryErr.message), {
          appointment_id: id,
        });
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }
    }

    // 3. Notify customer via WhatsApp (best effort)
    let customerNotified = false;
    let notifyError: string | undefined;
    if (notify_customer && tenant.wa_phone_number_id && apt.customer_phone) {
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, (tenant.timezone as string) || 'America/Merida');
      const body =
        `Hola${apt.customer_name ? ` ${apt.customer_name}` : ''} 👋\n\n` +
        `Le escribo de ${tenant.name} para avisarle que lamentablemente tenemos que cancelar su cita del *${dateFmt}* a las *${timeFmt}*.` +
        (reason ? `\n\nMotivo: ${reason}` : '') +
        `\n\n¿Le gustaría reagendar? Responda a este mensaje con el día y hora que le acomoden y con gusto le busco un espacio.` +
        `\n\nDisculpe las molestias.`;

      const res = await sendTextMessage(
        tenant.wa_phone_number_id as string,
        apt.customer_phone as string,
        body,
      );
      customerNotified = res.ok;
      if (!res.ok) notifyError = res.errorLabel || `http_${res.errorCode ?? 'unknown'}`;
    }

    // 4. Marketplace event — re-engagement/follow-up agents may want to act
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.cancelled_by_staff', {
        tenant_id: tenant.id,
        appointment_id: apt.id,
      });
    } catch {
      /* best effort */
    }

    return NextResponse.json({
      ok: true,
      calendarDeleted,
      customerNotified,
      notifyError,
    });
  } catch (err) {
    logger.error(
      '[api/appointments/[id]/cancel] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
