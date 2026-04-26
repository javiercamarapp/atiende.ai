import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';
import {
  createCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
} from '@/lib/calendar/google';

// ═════════════════════════════════════════════════════════════════════════════
// CALENDAR RECONCILE CRON
//
// Reconcilia el estado de Google Calendar contra la base de datos. La DB es
// fuente de verdad: cualquier cita activa con `calendar_sync_status='pending'`
// (creación o modificación) o `'cancel'` (borrado pendiente) representa un
// estado donde la cita existe en Postgres pero NO está reflejada en Google.
//
// Sin este cron, una caída de 30 minutos de la API de Google Calendar dejaría
// citas agendadas localmente pero invisibles en el calendario del staff —
// los clientes verían "✅ Cita agendada" en WhatsApp y el doctor no tendría
// nada en su calendario, causando ausencias y reputación dañada.
//
// Estrategia de retry:
//   - Backoff exponencial: 1min, 2min, 4min, 8min, 16min
//   - Después de 5 intentos fallidos → status='failed' + alerta a operadores
//   - Procesa máximo 100 citas por corrida para no saturar la API de Google
//   - Schedule: cada 5 minutos (ver vercel.json)
// ═════════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 100;

interface PendingRow {
  id: string;
  staff_id: string;
  google_event_id: string | null;
  customer_phone: string;
  customer_name: string | null;
  datetime: string;
  end_datetime: string;
  calendar_sync_status: string;
  calendar_sync_attempts: number;
  staff: { google_calendar_id: string | null } | { google_calendar_id: string | null }[] | null;
  service: { name: string | null } | { name: string | null }[] | null;
}

function nextBackoffMs(attempt: number): number {
  // 1, 2, 4, 8, 16 minutos
  return Math.min(60_000 * Math.pow(2, attempt), 16 * 60_000);
}

export async function GET(req: NextRequest) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const now = new Date();
  let synced = 0;
  let failed = 0;
  let exhausted = 0;
  const errors: string[] = [];

  const { data: pending } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, staff_id, google_event_id, customer_phone, customer_name, datetime, end_datetime, calendar_sync_status, calendar_sync_attempts, staff:staff_id(google_calendar_id), service:service_id(name)'
    )
    .in('calendar_sync_status', ['pending', 'cancel'])
    .lte('calendar_sync_next_retry_at', now.toISOString())
    .lt('calendar_sync_attempts', MAX_ATTEMPTS)
    .order('calendar_sync_next_retry_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, failed: 0, exhausted: 0 });
  }

  for (const row of pending as PendingRow[]) {
    const staffRel = Array.isArray(row.staff) ? row.staff[0] : row.staff;
    const calendarId = staffRel?.google_calendar_id;
    const serviceRel = Array.isArray(row.service) ? row.service[0] : row.service;

    // Sin calendar_id no hay nada que sincronizar — marcamos skip permanente.
    if (!calendarId) {
      await supabaseAdmin
        .from('appointments')
        .update({ calendar_sync_status: 'skip' })
        .eq('id', row.id);
      continue;
    }

    const attemptNum = (row.calendar_sync_attempts || 0) + 1;

    try {
      if (row.calendar_sync_status === 'cancel') {
        // Borrar evento remoto. Si el evento ya no existe (404), Google
        // devuelve error; lo tratamos como éxito porque el estado deseado
        // ya está logrado.
        if (row.google_event_id) {
          try {
            await cancelCalendarEvent(calendarId, row.google_event_id, row.staff_id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            // Si el evento ya no está en Google (404 / "Not Found"), aceptamos
            // como sincronizado: el estado deseado (no exista) ya se cumple.
            if (!/not found|404|deleted/i.test(msg)) throw err;
          }
        }
        await supabaseAdmin
          .from('appointments')
          .update({
            calendar_sync_status: 'synced',
            calendar_sync_attempts: attemptNum,
            calendar_sync_last_error: null,
          })
          .eq('id', row.id);
        synced++;
        continue;
      }

      // status === 'pending'
      if (!row.google_event_id) {
        // Crear evento (el create original falló).
        const ev = await createCalendarEvent({
          staffId: row.staff_id,
          calendarId,
          summary: `${serviceRel?.name || 'Cita'} - ${row.customer_name || 'Cliente'}`,
          description: `Agendada por WhatsApp AI\nTel: ${row.customer_phone}`,
          startTime: row.datetime,
          endTime: row.end_datetime,
        });
        if (!ev?.eventId) throw new Error('createCalendarEvent returned no eventId');
        await supabaseAdmin
          .from('appointments')
          .update({
            google_event_id: ev.eventId,
            calendar_sync_status: 'synced',
            calendar_sync_attempts: attemptNum,
            calendar_sync_last_error: null,
          })
          .eq('id', row.id);
      } else {
        // Update evento (el patch original falló).
        await updateCalendarEvent({
          staffId: row.staff_id,
          calendarId,
          eventId: row.google_event_id,
          startTime: row.datetime,
          endTime: row.end_datetime,
        });
        await supabaseAdmin
          .from('appointments')
          .update({
            calendar_sync_status: 'synced',
            calendar_sync_attempts: attemptNum,
            calendar_sync_last_error: null,
          })
          .eq('id', row.id);
      }
      synced++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.slice(0, 500) : 'reconcile failed';
      errors.push(`${row.id}: ${errMsg}`);

      if (attemptNum >= MAX_ATTEMPTS) {
        // Reintentos agotados → quedan en 'failed' para revisión humana.
        // Insertamos audit_log para que el dashboard de operaciones lo
        // muestre como alerta (no es silent).
        await supabaseAdmin
          .from('appointments')
          .update({
            calendar_sync_status: 'failed',
            calendar_sync_attempts: attemptNum,
            calendar_sync_last_error: errMsg,
            calendar_sync_next_retry_at: null,
          })
          .eq('id', row.id);
        await supabaseAdmin.from('audit_log').insert({
          action: 'calendar.sync_exhausted',
          entity_type: 'appointment',
          entity_id: row.id,
          details: { error: errMsg, attempts: attemptNum },
        });
        exhausted++;
      } else {
        const nextRetry = new Date(Date.now() + nextBackoffMs(attemptNum)).toISOString();
        await supabaseAdmin
          .from('appointments')
          .update({
            calendar_sync_attempts: attemptNum,
            calendar_sync_last_error: errMsg,
            calendar_sync_next_retry_at: nextRetry,
          })
          .eq('id', row.id);
        failed++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    synced,
    failed,
    exhausted,
    errors: errors.slice(0, 10), // sample para debugging, no exponer todos
  });
}
