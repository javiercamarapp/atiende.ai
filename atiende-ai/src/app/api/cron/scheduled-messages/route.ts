// ═════════════════════════════════════════════════════════════════════════════
// CRON — Scheduled Messages Dispatcher (Phase 3.D + hardening)
//
// Procesa cada hora la cola `scheduled_messages` — mensajes diferidos que
// MEDICAMENTO, RETENCIÓN, etc. dejaron programados.
//
// Backoff exponencial: cuando falla un envío, NO se reintenta inmediatamente
// (eso quema rate limits de WhatsApp). En cambio se programa `next_retry_at`
// con delay 2^retry_count minutos. El cron siguiente (1h después) procesará
// los que ya pasaron su next_retry_at.
//
// Después de 3 retries fallidos: status='failed' + notifyOwner.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';
import { alertOnCronFailure } from '@/lib/cron/alert-on-failure';

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
  message_type: string | null;
  retry_count: number;
  metadata?: Record<string, unknown> | null;
}

/** Delay en minutos para el próximo intento. Backoff: 2^n minutos. */
function nextRetryDelayMs(retryCount: number): number {
  // retry 0→1: 1 min, 1→2: 2 min, 2→3: 4 min (cap a 15 min)
  const minutes = Math.min(15, Math.pow(2, retryCount));
  return minutes * 60 * 1000;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();

  // AUDIT R24: claim atómico para prevenir doble envío cuando dos cron
  // instances arrancan concurrentes. Patrón: SELECT candidatos + UPDATE con
  // status guard y re-chequeo de next_retry_at, usando `next_retry_at` como
  // lock de 5 min. Otro cron concurrente ve next_retry_at en el futuro y salta
  // la fila. Si este run crashea, el lock expira y el siguiente cron la
  // reprocesa naturalmente — sin migración de schema.
  const { data: candidates, error: selErr } = await supabaseAdmin
    .from('scheduled_messages')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BATCH);

  if (selErr) {
    return NextResponse.json({ error: 'Query failed', message: selErr.message }, { status: 500 });
  }

  const candidateIds = (candidates || []).map((c) => c.id as string);
  if (candidateIds.length === 0) {
    return NextResponse.json({ processed: 0, duration_ms: Date.now() - start });
  }

  // Lock de 5 minutos sobre `next_retry_at`. Supera el maxDuration=300s del
  // cron con margen. El guard `.or(next_retry_at.is.null,lte)` descarta filas
  // que otro cron ya claim-eó entre el SELECT y este UPDATE.
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('scheduled_messages')
    .update({ next_retry_at: lockUntil })
    .in('id', candidateIds)
    .eq('status', 'pending')
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .select('id, tenant_id, patient_phone, message_content, message_type, retry_count, metadata');

  if (claimErr) {
    return NextResponse.json({ error: 'Claim failed', message: claimErr.message }, { status: 500 });
  }

  const batch = (claimed as ScheduledRow[] | null) || [];
  if (batch.length === 0) {
    return NextResponse.json({ processed: 0, duration_ms: Date.now() - start });
  }

  // Cache tenant info (wa_phone_number_id + name + owner_phone para alertas)
  const tenantIds = Array.from(new Set(batch.map((b) => b.tenant_id)));
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name, wa_phone_number_id, owner_phone, phone')
    .in('id', tenantIds);
  const tenantMap = new Map<string, { phoneNumberId?: string; name: string; ownerPhone?: string }>();
  for (const t of (tenants as Array<{ id: string; name: string; wa_phone_number_id: string | null; owner_phone: string | null; phone: string | null }> | null) || []) {
    tenantMap.set(t.id, {
      phoneNumberId: t.wa_phone_number_id ?? undefined,
      name: t.name,
      ownerPhone: t.owner_phone || t.phone || undefined,
    });
  }

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const failureSamples: Array<{ id: string; tenant: string; error: string }> = [];
  // AUDIT R31: rastrear tenants con cualquier fallo definitivo. El cálculo
  // previo `tenantIds.length - (failed > 0 ? 1 : 0)` contaba máximo 1 tenant
  // fallido aunque N tenants tuvieran mensajes fallidos — corrompe SLA metrics.
  const failedTenantIds = new Set<string>();

  for (const msg of batch) {
    const tInfo = tenantMap.get(msg.tenant_id);
    const phoneNumberId = tInfo?.phoneNumberId;

    if (!phoneNumberId) {
      await supabaseAdmin
        .from('scheduled_messages')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString(),
          metadata: { ...(msg.metadata ?? {}), reason: 'tenant_missing_wa_phone_number_id' },
        })
        .eq('id', msg.id);
      failed++;
      failedTenantIds.add(msg.tenant_id);
      continue;
    }

    // Verificar opt-out del paciente antes de enviar (LFPDPPP compliance)
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('opted_out')
      .eq('tenant_id', msg.tenant_id)
      .eq('phone', msg.patient_phone)
      .maybeSingle();
    if (contact?.opted_out === true) {
      await supabaseAdmin
        .from('scheduled_messages')
        .update({
          status: 'cancelled',
          metadata: { ...(msg.metadata ?? {}), reason: 'patient_opted_out' },
        })
        .eq('id', msg.id);
      continue;
    }

    try {
      const sendResult = await sendTextMessage(phoneNumberId, msg.patient_phone, msg.message_content);
      if (!sendResult.ok) {
        throw new Error(`${sendResult.errorLabel || 'send_failed'}: ${sendResult.errorMessage || 'unknown'}`);
      }
      await supabaseAdmin
        .from('scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', msg.id);
      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const nextRetry = (msg.retry_count ?? 0) + 1;

      if (nextRetry >= MAX_RETRIES) {
        // Tope alcanzado — marcar como failed + notificar al owner
        await supabaseAdmin
          .from('scheduled_messages')
          .update({
            status: 'failed',
            retry_count: nextRetry,
            metadata: { ...(msg.metadata ?? {}), last_error: errMsg, failed_at: new Date().toISOString() },
          })
          .eq('id', msg.id);
        failed++;
        failedTenantIds.add(msg.tenant_id);
        failureSamples.push({ id: msg.id, tenant: tInfo?.name || msg.tenant_id, error: errMsg });

        // notifyOwner del tenant (best effort)
        if (tInfo?.ownerPhone && phoneNumberId) {
          try {
            await sendTextMessage(
              phoneNumberId,
              tInfo.ownerPhone,
              `⚠️ Recordatorio programado falló 3 veces:\nTipo: ${msg.message_type || 'unknown'}\nPaciente: ${msg.patient_phone}\nError: ${errMsg.slice(0, 100)}`,
            );
          } catch {
            /* best effort */
          }
        }
      } else {
        // Programar retry con backoff exponencial
        const delayMs = nextRetryDelayMs(nextRetry);
        const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        await supabaseAdmin
          .from('scheduled_messages')
          .update({
            retry_count: nextRetry,
            next_retry_at: nextRetryAt,
            metadata: { ...(msg.metadata ?? {}), last_error: errMsg, last_retry_at: new Date().toISOString() },
          })
          .eq('id', msg.id);
        deferred++;
      }
    }
  }

  await logCronRun({
    jobName: 'scheduled-messages',
    startedAt: new Date(start),
    tenantsProcessed: tenantIds.length,
    tenantsSucceeded: tenantIds.length - failedTenantIds.size,
    tenantsFailed: failedTenantIds.size,
    details: { total_messages: batch.length, sent, failed, deferred, failure_samples: failureSamples.slice(0, 5) },
  });

  // Alert a Javier si hubo fallos completos (tras 3 retries)
  if (failed > 0) {
    await alertOnCronFailure(
      'scheduled-messages',
      tenantIds.length,
      failed,
      failureSamples[0]?.error,
    ).catch(() => {
      /* best effort */
    });
  }

  return NextResponse.json({
    processed: batch.length,
    sent,
    failed,
    deferred,
    duration_ms: Date.now() - start,
  });
}
