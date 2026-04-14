// ═════════════════════════════════════════════════════════════════════════════
// CRON — Scheduled Messages Dispatcher (Phase 3.D)
//
// Procesa cada hora la cola `scheduled_messages` — mensajes diferidos que
// MEDICAMENTO, RETENCIÓN, etc. dejaron programados. Marca como 'sent' o
// 'failed' y reintenta hasta 3 veces antes de darse por vencido.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BATCH = 500;
const MAX_RETRIES = 3;

interface ScheduledRow {
  id: string;
  tenant_id: string;
  patient_phone: string;
  message_content: string;
  retry_count: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const now = new Date().toISOString();

  const { data: due, error } = await supabaseAdmin
    .from('scheduled_messages')
    .select('id, tenant_id, patient_phone, message_content, retry_count')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return NextResponse.json({ error: 'Query failed', message: error.message }, { status: 500 });
  }

  const batch = (due as ScheduledRow[] | null) || [];
  if (batch.length === 0) {
    return NextResponse.json({ processed: 0, duration_ms: Date.now() - start });
  }

  // Cache tenant wa_phone_number_id
  const tenantIds = Array.from(new Set(batch.map((b) => b.tenant_id)));
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, wa_phone_number_id')
    .in('id', tenantIds);
  const phoneIdMap = new Map<string, string>();
  for (const t of tenants || []) {
    if (t.wa_phone_number_id) phoneIdMap.set(t.id as string, t.wa_phone_number_id as string);
  }

  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const msg of batch) {
    const phoneNumberId = phoneIdMap.get(msg.tenant_id);
    if (!phoneNumberId) {
      await supabaseAdmin
        .from('scheduled_messages')
        .update({ status: 'failed', sent_at: new Date().toISOString() })
        .eq('id', msg.id);
      failed++;
      continue;
    }

    try {
      await sendTextMessage(phoneNumberId, msg.patient_phone, msg.message_content);
      await supabaseAdmin
        .from('scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', msg.id);
      sent++;
    } catch (err) {
      const nextRetry = (msg.retry_count ?? 0) + 1;
      if (nextRetry >= MAX_RETRIES) {
        await supabaseAdmin
          .from('scheduled_messages')
          .update({
            status: 'failed',
            retry_count: nextRetry,
            metadata: { last_error: err instanceof Error ? err.message : String(err) },
          })
          .eq('id', msg.id);
        failed++;
      } else {
        await supabaseAdmin
          .from('scheduled_messages')
          .update({ retry_count: nextRetry })
          .eq('id', msg.id);
        deferred++;
      }
    }
  }

  await logCronRun({
    jobName: 'scheduled-messages',
    startedAt: new Date(start),
    tenantsProcessed: tenantIds.length,
    tenantsSucceeded: tenantIds.length,
    tenantsFailed: 0,
    details: { total_messages: batch.length, sent, failed, deferred },
  });

  return NextResponse.json({
    processed: batch.length,
    sent,
    failed,
    deferred,
    duration_ms: Date.now() - start,
  });
}
