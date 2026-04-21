// ═════════════════════════════════════════════════════════════════════════════
// CRON — Review Candidate Sweep
//
// Semanal. Escanea mensajes recientes de bot por tenant y marca como "review
// candidate" aquellas respuestas donde el bot dudó (hedge, deflect, respuesta
// vaga). Alimenta el widget de Conversation Review en /knowledge sin esperar
// a que el processor.ts las detecte en vivo — así los tenants nuevos ven un
// set inicial desde la primera visita.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import { sweepRecentMessages } from '@/lib/knowledge/detect-review-candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const tenants = await listEligibleTenants({ requireToolCalling: false });

  let processed = 0;
  let failed = 0;
  let totalScanned = 0;
  let totalRecorded = 0;
  const summaries: Array<Record<string, unknown>> = [];

  for (const t of tenants) {
    try {
      const tenantId = t.id as string;
      const { scanned, recorded } = await sweepRecentMessages({ tenantId });
      totalScanned += scanned;
      totalRecorded += recorded;
      summaries.push({ tenant_id: tenantId, scanned, recorded });
      processed++;
    } catch (err) {
      console.error('[cron/review-candidate-sweep] tenant failed:', err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'review-candidate-sweep',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { summaries, total_scanned: totalScanned, total_recorded: totalRecorded },
  });

  return NextResponse.json({
    processed,
    failed,
    total_scanned: totalScanned,
    total_recorded: totalRecorded,
    duration_ms: Date.now() - start,
  });
}
