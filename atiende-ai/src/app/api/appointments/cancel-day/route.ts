import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cancelCalendarEvent } from '@/lib/calendar/google';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 60;
export const runtime = 'nodejs';

const BodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(300).optional(),
  notify_customers: z.boolean().optional().default(true),
  staff_id: z.string().uuid().optional(),
});

function formatDateTimeMx(iso: string, timezone = 'America/Merida') {
  const d = new Date(iso);
  const dateFmt = d.toLocaleDateString('es-MX', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeFmt = d.toLocaleTimeString('es-MX', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true,
  });
  return { dateFmt, timeFmt };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_cancel_day`, 5, 300)) {
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
    const { date, reason, notify_customers, staff_id } = parsed.data;

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

    const tenantResolved = tenant as { id: string; name: string; timezone: string | null; wa_phone_number_id: string | null };
    const timezone = tenantResolved.timezone || 'America/Merida';
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    let aptsQ = supabaseAdmin
      .from('appointments')
      .select(
        'id, datetime, staff_id, google_event_id, customer_name, customer_phone, staff:staff_id(google_calendar_id)',
      )
      .eq('tenant_id', tenant.id)
      .gte('datetime', dayStart.toISOString())
      .lte('datetime', dayEnd.toISOString())
      .in('status', ['scheduled', 'confirmed']);
    if (staff_id) aptsQ = aptsQ.eq('staff_id', staff_id);

    const { data: appts } = await aptsQ;

    type Row = {
      id: string;
      datetime: string;
      staff_id: string;
      google_event_id: string | null;
      customer_name: string | null;
      customer_phone: string;
      staff: { google_calendar_id: string | null } | { google_calendar_id: string | null }[] | null;
    };
    const rows = (appts || []) as unknown as Row[];

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, cancelled: 0, notified: 0 });
    }

    // Bulk update status first (atomic-ish)
    const ids = rows.map((a) => a.id);
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'cancelled', cancellation_reason: reason ?? null })
      .in('id', ids);
    if (updErr) {
      // Retry without cancellation_reason column if missing
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled' })
        .in('id', ids);
    }

    // Auto-add cancelled patients to appointment_waitlist with their
    // original date/staff as preference. Cuando el doctor reagende
    // (o se libere otro slot), runOptimizador les notifica primero
    // con prioridad FIFO. Esto convierte el "doctor canceló mi cita"
    // en "el sistema me avisará apenas haya espacio nuevo".
    try {
      const waitlistInserts = rows.map((r) => {
        const dt = new Date(r.datetime);
        const hour = dt.getUTCHours();
        let timeWindow: 'morning' | 'afternoon' | 'evening';
        if (hour < 12) timeWindow = 'morning';
        else if (hour < 17) timeWindow = 'afternoon';
        else timeWindow = 'evening';
        return {
          tenant_id: tenant.id,
          customer_phone: r.customer_phone,
          customer_name: r.customer_name,
          staff_id: r.staff_id,
          // Acepta cualquier fecha desde la cancelada hasta 30 días después
          preferred_date_from: date,
          preferred_date_to: new Date(dayStart.getTime() + 30 * 86400000)
            .toISOString()
            .slice(0, 10),
          preferred_time_window: timeWindow,
          notes: `Auto-añadido tras cancelación masiva${reason ? ': ' + reason : ''}`,
        };
      });
      await supabaseAdmin.from('appointment_waitlist').insert(waitlistInserts);
    } catch (err) {
      // No bloquea el flow — la waitlist es nice-to-have
      logger.warn('[cancel-day] waitlist auto-add failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // For each row: cancel Google event + (optional) notify via WA in parallel,
    // but rate-limited to avoid WA throttling if there are many.
    let notified = 0;
    let calendarCancelled = 0;

    const concurrency = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < rows.length) {
        const idx = cursor++;
        const r = rows[idx];

        // Cancel Google event
        if (r.google_event_id) {
          const rel = Array.isArray(r.staff) ? r.staff[0] : r.staff;
          const calendarId = (rel as { google_calendar_id: string | null } | null)?.google_calendar_id;
          if (calendarId) {
            try {
              await cancelCalendarEvent(calendarId, r.google_event_id, r.staff_id);
              calendarCancelled++;
            } catch { /* best effort */ }
          }
        }

        // Notify
        if (notify_customers && tenantResolved.wa_phone_number_id && r.customer_phone) {
          const { dateFmt, timeFmt } = formatDateTimeMx(r.datetime, timezone);
          const body =
            `Hola${r.customer_name ? ` ${r.customer_name}` : ''} 👋\n\n` +
            `Le escribo de ${tenantResolved.name} para avisarle que lamentablemente tenemos que cancelar su cita del *${dateFmt}* a las *${timeFmt}*.` +
            (reason ? `\n\nMotivo: ${reason}` : '') +
            `\n\nLe agregamos a nuestra lista de espera con prioridad — apenas se libere un horario que le acomode, le aviso por aquí.` +
            `\n\n¿O prefiere reagendar ahora mismo? Responda con el día y hora que le acomoden y lo agendamos al instante.` +
            `\n\nDisculpe las molestias.`;
          try {
            const res = await sendTextMessage(
              tenantResolved.wa_phone_number_id as string,
              r.customer_phone,
              body,
            );
            if (res.ok) notified++;
          } catch { /* best effort */ }
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Fire marketplace event
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointments.cancelled_bulk', {
        tenant_id: tenant.id,
        date,
        count: rows.length,
      });
    } catch { /* best effort */ }

    return NextResponse.json({
      ok: true,
      cancelled: rows.length,
      calendarCancelled,
      notified,
    });
  } catch (err) {
    logger.error(
      '[api/appointments/cancel-day] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
