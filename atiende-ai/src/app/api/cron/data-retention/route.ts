// ═════════════════════════════════════════════════════════════════════════════
// DATA RETENTION CRON — LFPDPPP compliance (FIX 12)
//
// La Ley Federal de Protección de Datos Personales en Posesión de los
// Particulares (México) exige que los datos personales se conserven solo
// durante el tiempo necesario para cumplir su finalidad.
//
// Política aplicada:
//   - Mensajes WA inbound/outbound: 13 meses (suficiente para 1 año de
//     retención clínica + 1 mes de cola de quejas).
//   - Citas pasadas marcadas como cancelled o no_show: 13 meses.
//   - Webhook_logs / api_logs: 30 días (cleanup ya lo hace, no duplicamos).
//
// Schedule: domingo 03:00 UTC (~21:00 CDMX/Mérida sábado).
// vercel.json → "0 3 * * 0"
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const RETENTION_DAYS_MESSAGES = 395; // ~13 meses
const RETENTION_DAYS_APPOINTMENTS = 395;

export async function GET(req: NextRequest) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const start = Date.now();
  const summary: Record<string, unknown> = {};

  // 1. Mensajes antiguos
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS_MESSAGES * 86_400_000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('messages')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) throw error;
    summary.messages_deleted = count ?? 0;
  } catch (err) {
    summary.messages_error = err instanceof Error ? err.message : String(err);
  }

  // 2. Citas pasadas marcadas como cancelled / no_show
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS_APPOINTMENTS * 86_400_000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('appointments')
      .delete({ count: 'exact' })
      .in('status', ['cancelled', 'no_show'])
      .lt('datetime', cutoff);
    if (error) throw error;
    summary.appointments_deleted = count ?? 0;
  } catch (err) {
    summary.appointments_error = err instanceof Error ? err.message : String(err);
  }

  // 3. Contacts opted-out hace >395 días → borrado total (DROP_PII)
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS_MESSAGES * 86_400_000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('contacts')
      .delete({ count: 'exact' })
      .eq('opted_out', true)
      .lt('opted_out_at', cutoff);
    if (error) throw error;
    summary.optedout_contacts_deleted = count ?? 0;
  } catch (err) {
    summary.optedout_contacts_error = err instanceof Error ? err.message : String(err);
  }

  // audit_log guarda PII en `details` JSONB (phone, name, email, event
  // data). LFPDPPP ARCO exige retención limitada — 13 meses iguala la
  // política de messages/appointments.
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS_MESSAGES * 86_400_000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('audit_log')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) throw error;
    summary.audit_log_deleted = count ?? 0;
  } catch (err) {
    summary.audit_log_error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    status: 'ok',
    duration_ms: Date.now() - start,
    summary,
  });
}
