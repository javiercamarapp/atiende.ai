// ═════════════════════════════════════════════════════════════════════════════
// CRON — Telemed link auto-send 15 min antes (Phase 2.C polish)
//
// Cada 5 min: busca appointments is_telemedicine=true cuyo datetime cae en
// los próximos 10..20 min, sin link enviado todavía. Manda el link via la
// misma lógica de send_telemed_link.
//
// Ventana 10..20 min (no exactamente 15) por si el cron se atrasa o si una
// cita queda en el límite — el agente además puede enviar on-demand si el
// paciente pregunta antes.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessageSafe } from '@/lib/whatsapp/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AptToSend {
  id: string;
  tenant_id: string;
  customer_phone: string;
  telemed_room: string;
  datetime: string;
  tenant: { wa_phone_number_id: string | null } | { wa_phone_number_id: string | null }[] | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = new Date();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  const windowStart = new Date(Date.now() + 10 * 60_000).toISOString();
  const windowEnd = new Date(Date.now() + 20 * 60_000).toISOString();

  const { data: aptsRaw, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, tenant_id, customer_phone, telemed_room, datetime,
      tenant:tenant_id(wa_phone_number_id)
    `)
    .eq('is_telemedicine', true)
    .neq('status', 'cancelled')
    .neq('status', 'no_show')
    .is('telemed_link_sent_at', null)
    .not('telemed_room', 'is', null)
    .gte('datetime', windowStart)
    .lt('datetime', windowEnd)
    .limit(200);

  if (error) {
    console.error('[cron/telemed-link-presend] query failed:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const apts = (aptsRaw || []) as unknown as AptToSend[];
  let sent = 0;
  let failed = 0;
  const summaries: Array<Record<string, unknown>> = [];

  for (const apt of apts) {
    const tenant = Array.isArray(apt.tenant) ? apt.tenant[0] : apt.tenant;
    const phoneNumberId = tenant?.wa_phone_number_id || '';
    if (!phoneNumberId || !apt.customer_phone || !apt.telemed_room) {
      summaries.push({ apt_id: apt.id, skipped: 'missing_config' });
      continue;
    }

    const url = `${baseUrl}/telemed/${apt.telemed_room}?t=${apt.id}`;
    const text =
      `Su consulta virtual comienza pronto. Abra este link para entrar:\n\n${url}\n\n` +
      `Le pedirá permiso de cámara y micrófono. Si no puede, llame al consultorio.`;

    try {
      const r = await sendTextMessageSafe(phoneNumberId, apt.customer_phone, text, {
        tenantId: apt.tenant_id,
      });
      if (!r.ok) {
        failed++;
        summaries.push({ apt_id: apt.id, error: r.windowExpired ? 'window_expired' : 'send_failed' });
        continue;
      }
      // Marcar como enviado para no duplicar en la próxima corrida
      await supabaseAdmin
        .from('appointments')
        .update({ telemed_link_sent_at: new Date().toISOString() })
        .eq('id', apt.id)
        .eq('tenant_id', apt.tenant_id);
      sent++;
    } catch (err) {
      failed++;
      summaries.push({
        apt_id: apt.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logCronRun({
    jobName: 'telemed-link-presend',
    startedAt: start,
    tenantsProcessed: sent + failed,
    tenantsSucceeded: sent,
    tenantsFailed: failed,
    details: { window: '10-20min', summaries: summaries.slice(0, 10) },
  });

  return NextResponse.json({ ok: true, sent, failed, total_in_window: apts.length });
}
