// ═════════════════════════════════════════════════════════════════════════════
// CRON — Notify Retry (R4 FIX 5 follow-up)
//
// Cada 15 minutos (*/15 * * * *) escanea citas futuras con
// owner_notified=false y reintenta notificar al dueño con backoff
// exponencial: 1, 2, 4, 8, 16 minutos entre intentos (máx 5 retries).
//
// Esquema de backoff (minutos desde el último intento):
//   retry_count=0 → inmediato (primer intento del cron)
//   retry_count=1 → espera ≥1 min
//   retry_count=2 → espera ≥2 min
//   retry_count=3 → espera ≥4 min
//   retry_count=4 → espera ≥8 min
//   retry_count=5 → DETENIDO (permanentemente fallido, alerta crítica)
//
// Autenticación: Bearer ${CRON_SECRET} via requireCronAuth.
// Logging: cada run se persiste en `cron_runs`.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notifyOwner } from '@/lib/actions/notifications';
import { formatDateTimeMx } from '@/lib/actions/appointment-helpers';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RETRIES = 5;
const BATCH_LIMIT = 50;

interface CandidateRow {
  id: string;
  tenant_id: string;
  customer_name: string | null;
  customer_phone: string;
  service_id: string | null;
  datetime: string;
  confirmation_code: string | null;
  owner_notified_at: string | null;
  owner_notify_retry_count: number | null;
  owner_notify_error: string | null;
}

interface TenantLite {
  id: string;
  timezone: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const startedAt = new Date();
  const now = Date.now();

  // 1. Candidatos: citas futuras pendientes de notificar, con retry_count < MAX.
  const { data: candidates, error } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, tenant_id, customer_name, customer_phone, service_id, datetime, confirmation_code, owner_notified_at, owner_notify_retry_count, owner_notify_error',
    )
    .eq('owner_notified', false)
    .in('status', ['scheduled', 'confirmed'])
    .gt('datetime', new Date(now).toISOString())
    .lt('owner_notify_retry_count', MAX_RETRIES)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[cron/notify-retry] candidates query failed:', error.message);
    return NextResponse.json(
      { error: 'candidates_query_failed', message: error.message },
      { status: 500 },
    );
  }

  const rows = (candidates || []) as CandidateRow[];

  // 2. Filtrado en memoria por backoff — evita SQL con POWER(2,x) cross-driver.
  const eligible = rows.filter((r) => {
    const count = r.owner_notify_retry_count ?? 0;
    if (count === 0) return true;
    if (!r.owner_notified_at) return true;
    const waitMs = Math.pow(2, count - 1) * 60_000; // 1,2,4,8,16 min
    return now - new Date(r.owner_notified_at).getTime() >= waitMs;
  });

  if (eligible.length === 0) {
    await logCronRun({
      jobName: 'notify-retry',
      startedAt,
      tenantsProcessed: 0,
      tenantsSucceeded: 0,
      tenantsFailed: 0,
      details: { processed: 0, note: 'no eligible candidates' },
    });
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      permanently_failed: 0,
      duration_ms: Date.now() - startedAt.getTime(),
    });
  }

  // 3. Pre-cargar tenants únicos (timezone) + services (name) en 2 queries
  // batch para no repetir lookups por cada cita.
  const tenantIds = Array.from(new Set(eligible.map((r) => r.tenant_id)));
  const serviceIds = Array.from(
    new Set(eligible.map((r) => r.service_id).filter((s): s is string => !!s)),
  );

  const [tenantsRes, servicesRes] = await Promise.all([
    supabaseAdmin.from('tenants').select('id, timezone').in('id', tenantIds),
    serviceIds.length > 0
      ? supabaseAdmin.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const tenantMap = new Map<string, TenantLite>();
  for (const t of ((tenantsRes.data || []) as TenantLite[])) tenantMap.set(t.id, t);
  const serviceMap = new Map<string, string>();
  for (const s of ((servicesRes.data || []) as Array<{ id: string; name: string }>)) {
    serviceMap.set(s.id, s.name);
  }

  // 4. Agrupar candidatos por tenant + procesar (secuencial dentro del tenant
  //    para no saturar WhatsApp de ese owner; paralelo entre tenants).
  const byTenant = new Map<string, CandidateRow[]>();
  for (const r of eligible) {
    const arr = byTenant.get(r.tenant_id) || [];
    arr.push(r);
    byTenant.set(r.tenant_id, arr);
  }

  let succeeded = 0;
  let failed = 0;
  let permanentlyFailed = 0;
  const permanentlyFailedIds: string[] = [];
  // AUDIT R31: Set per-tenant para SLA metrics correctas. La fórmula anterior
  // (`failed > 0 ? 1 : 0`) subcontaba cuando N tenants fallaban simultáneos.
  const failedTenantIds = new Set<string>();

  await Promise.allSettled(
    Array.from(byTenant.entries()).map(async ([tenantId, appts]) => {
      const tenant = tenantMap.get(tenantId);
      const timezone = tenant?.timezone || 'America/Merida';

      for (const a of appts) {
        const { dateFmt, timeFmt } = formatDateTimeMx(a.datetime, timezone);
        const serviceName = a.service_id ? serviceMap.get(a.service_id) : null;
        const details =
          `${a.customer_name || 'Paciente'} (${a.customer_phone})\n` +
          `${serviceName || 'Consulta'}\n${dateFmt} ${timeFmt}` +
          (a.confirmation_code ? `\nCódigo: ${a.confirmation_code}` : '');

        const res = await notifyOwner({
          tenantId,
          event: 'new_appointment',
          details,
        });

        if (res.ok) {
          succeeded++;
          await supabaseAdmin
            .from('appointments')
            .update({
              owner_notified: true,
              owner_notified_at: new Date().toISOString(),
              owner_notify_error: null,
            })
            .eq('id', a.id);
        } else {
          failed++;
          failedTenantIds.add(tenantId);
          const nextCount = (a.owner_notify_retry_count ?? 0) + 1;
          await supabaseAdmin
            .from('appointments')
            .update({
              owner_notify_retry_count: nextCount,
              owner_notify_error: res.error || 'unknown_error',
              owner_notified_at: new Date().toISOString(),
            })
            .eq('id', a.id);

          if (nextCount >= MAX_RETRIES) {
            permanentlyFailed++;
            permanentlyFailedIds.push(a.id);
            console.error(
              `[cron/notify-retry] appointment ${a.id} permanently failed after ${MAX_RETRIES} retries. Last error: ${res.error}`,
            );
          }
        }
      }
    }),
  );

  await logCronRun({
    jobName: 'notify-retry',
    startedAt,
    tenantsProcessed: byTenant.size,
    tenantsSucceeded: byTenant.size - failedTenantIds.size,
    tenantsFailed: failedTenantIds.size,
    details: {
      processed: eligible.length,
      succeeded,
      failed,
      permanently_failed: permanentlyFailed,
      failed_permanently: permanentlyFailedIds,
    },
  });

  return NextResponse.json({
    processed: eligible.length,
    succeeded,
    failed,
    permanently_failed: permanentlyFailed,
    duration_ms: Date.now() - startedAt.getTime(),
  });
}
