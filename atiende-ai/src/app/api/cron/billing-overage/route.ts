// ═════════════════════════════════════════════════════════════════════════════
// CRON — Billing de overage de voz (mensual)
//
// Schedule: 1er día del mes, 8am UTC (~2am Mérida).
// Cierra el ciclo del mes ANTERIOR:
//   1. SELECT voice_usage WHERE year_month = mes_anterior
//      AND overage_minutes > 0 AND overage_billed = false
//   2. Por cada fila: reporta usageRecord a Stripe con los minutos extra
//   3. Marca overage_billed=true + guarda stripe_usage_record_id
//   4. Persiste resumen en cron_runs
//
// Error handling: best-effort por tenant — si uno falla, sigue con los demás.
// Si stripe_subscription_item_voice_id no está configurado, skip (no es
// premium o aún no activó la suscripción — sin daño).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reportVoiceOverageToStripe } from '@/lib/billing/stripe';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';
import { VOICE_OVERAGE_MONTHLY_CAP } from '@/lib/config';

// Lock Redis para idempotency a nivel cron run. Vercel ocasionalmente
// dispara crons 2x el mismo día. Si pasa, sin este lock cobraríamos el
// overage doble. El WHERE overage_billed=false es la red defensiva extra
// (solo cobramos las filas que aún no están marcadas), pero el lock evita
// la condición de carrera entre el SELECT y el UPDATE.
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface UsageRow {
  id: string;
  tenant_id: string;
  year_month: string;
  overage_minutes: number;
  tenants: {
    stripe_subscription_item_voice_id: string | null;
    name: string | null;
  } | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const startedAt = new Date();

  // Calcular mes anterior (YYYY-MM)
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  const lastMonth = now.toISOString().substring(0, 7);

  // Lock idempotency — el cron solo puede correr una vez por mes-objetivo.
  // TTL 7 días para que un retry tardío del próximo día también sea bloqueado.
  const redis = getRedis();
  if (redis) {
    const lockKey = `cron:billing-overage:${lastMonth}`;
    try {
      const acquired = await redis.set(lockKey, new Date().toISOString(), {
        nx: true,
        ex: 7 * 24 * 3600,
      });
      if (acquired !== 'OK') {
        console.warn(`[cron/billing-overage] already ran for ${lastMonth}, skipping`);
        return NextResponse.json({
          status: 'already_processed',
          month: lastMonth,
          duration_ms: Date.now() - startedAt.getTime(),
        });
      }
    } catch (err) {
      console.warn('[cron/billing-overage] redis lock failed, proceeding:', err instanceof Error ? err.message : err);
      // Continuamos sin lock — el WHERE overage_billed=false es la red de seguridad
    }
  }

  // Candidatos: overage > 0 del mes anterior y aún no cobrado
  const { data: pending, error } = await supabaseAdmin
    .from('voice_usage')
    .select(`
      id,
      tenant_id,
      year_month,
      overage_minutes,
      tenants!inner(stripe_subscription_item_voice_id, name)
    `)
    .eq('year_month', lastMonth)
    .gt('overage_minutes', 0)
    .eq('overage_billed', false)
    .limit(500);

  if (error) {
    console.error('[cron/billing-overage] candidates query failed:', error.message);
    return NextResponse.json(
      { error: 'candidates_query_failed', message: error.message },
      { status: 500 },
    );
  }

  const rows = (pending || []) as unknown as UsageRow[];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let cappedAlerts = 0;
  const failedIds: string[] = [];

  for (const row of rows) {
    const itemId = row.tenants?.stripe_subscription_item_voice_id;
    if (!itemId) {
      console.warn(
        `[cron/billing-overage] tenant ${row.tenant_id} has no stripe_subscription_item_voice_id — skipping`,
      );
      skipped++;
      continue;
    }

    // Cap mensual contra abuse / mal-config. Si un tenant acumula más de
    // VOICE_OVERAGE_MONTHLY_CAP min (default 1000 = $5,000 MXN), capamos
    // el cobro y alertamos al equipo. Evita facturas catastróficas si bot
    // recibe spam o staff calling loop.
    let billableMinutes = Number(row.overage_minutes);
    if (billableMinutes > VOICE_OVERAGE_MONTHLY_CAP) {
      console.error(
        `[cron/billing-overage] CAP HIT — tenant ${row.tenant_id} (${row.tenants?.name}) ` +
        `acumuló ${billableMinutes} min overage en ${row.year_month}. ` +
        `Capado a ${VOICE_OVERAGE_MONTHLY_CAP} min. Revisar manual.`,
      );
      billableMinutes = VOICE_OVERAGE_MONTHLY_CAP;
      cappedAlerts++;
    }

    // Pasar year_month de la row (ej. "2026-03") como periodKey estable,
    // para que la idempotency key de Stripe sea determinística aunque el
    // retry cruce el mes calendario.
    const result = await reportVoiceOverageToStripe(itemId, billableMinutes, row.year_month);

    if (result.success) {
      await supabaseAdmin
        .from('voice_usage')
        .update({
          overage_billed: true,
          overage_billed_at: new Date().toISOString(),
          stripe_usage_record_id: result.recordId ?? null,
        })
        .eq('id', row.id);
      succeeded++;
    } else {
      failed++;
      failedIds.push(row.id);
    }
  }

  await logCronRun({
    jobName: 'billing-overage',
    startedAt,
    tenantsProcessed: rows.length,
    tenantsSucceeded: succeeded,
    tenantsFailed: failed,
    details: {
      month: lastMonth,
      processed: rows.length,
      succeeded,
      failed,
      skipped,
      capped_alerts: cappedAlerts,
      failed_ids: failedIds,
    },
  });

  return NextResponse.json({
    month: lastMonth,
    processed: rows.length,
    succeeded,
    failed,
    skipped,
    duration_ms: Date.now() - startedAt.getTime(),
  });
}
