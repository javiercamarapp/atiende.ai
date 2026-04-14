// ═════════════════════════════════════════════════════════════════════════════
// CRON — Agent Performance (Phase 3.D)
//
// Nocturno. Calcula métricas agregadas (resolution_rate, error_rate, cost) de
// cada agente por tenant sobre las últimas 24h y las persiste en
// `benchmark_metrics` para el dashboard de Javier.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  calculateAgentMetrics,
  getTopFailingTools,
} from '@/lib/agents/internal/agent-performance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const dateTo = new Date().toISOString();
  const dateFrom = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const tenants = await listEligibleTenants({ requireToolCalling: false });
  let processed = 0;
  let failed = 0;
  const perTenant: Array<Record<string, unknown>> = [];

  for (const t of tenants) {
    try {
      const tenantId = t.id as string;
      const metrics = await calculateAgentMetrics({ tenantId, dateFrom, dateTo });
      const failingTools = await getTopFailingTools({ tenantId, limit: 5 });
      // Las métricas viven en cron_runs.details para auditoría; Javier las
      // consulta desde ahí hasta que exista una tabla dedicada.
      perTenant.push({ tenant_id: tenantId, metrics, failing_tools: failingTools });
      processed++;
    } catch (err) {
      console.error('[cron/agent-performance] tenant failed:', err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'agent-performance',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { per_tenant: perTenant },
  });

  return NextResponse.json({
    processed,
    failed,
    date_from: dateFrom,
    date_to: dateTo,
    duration_ms: Date.now() - start,
  });
}
