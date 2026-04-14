// ═════════════════════════════════════════════════════════════════════════════
// CRON — Retention Worker (Phase 3.D)
//
// Reactiva pacientes en riesgo de churn. Corre semanal los martes 10am UTC
// (4am America/Merida). El worker usa get_patients_at_risk + genera mensajes
// personalizados con LLM y los envía vía WhatsApp.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth, runAgentWorkerForAllTenants } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/retencion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const summary = await runAgentWorkerForAllTenants({
    jobName: 'retention',
    agentName: 'retencion',
    requireFeature: 'retention_worker',
    triggerMessage: () =>
      'Procesa la lista de pacientes en riesgo de churn y envía mensajes personalizados de reactivación.',
  });

  if (summary.failed > 0) {
    const { alertOnCronFailure } = await import('@/lib/cron/alert-on-failure');
    await alertOnCronFailure(
      'retention',
      summary.processed,
      summary.failed,
      summary.results.find((r) => !r.success)?.error,
    ).catch(() => {});
  }

  return NextResponse.json(summary);
}
