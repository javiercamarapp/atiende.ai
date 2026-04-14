// ═════════════════════════════════════════════════════════════════════════════
// CRON — Intent Quality (Phase 3.D)
//
// Nocturno. Muestrea 10% de las conversaciones del día y las audita con LLM
// para detectar misclassifications del orquestador. Persiste en
// `benchmark_metrics` para que Javier monitoree calidad por tenant.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  sampleConversationsForReview,
  detectMisclassifiedIntent,
  generateQualityReport,
} from '@/lib/agents/internal/intent-quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SAMPLE_RATE = 0.1;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const date = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const tenants = await listEligibleTenants({ requireToolCalling: false });

  let processed = 0;
  let failed = 0;
  const summaries: Array<Record<string, unknown>> = [];

  for (const t of tenants) {
    try {
      const tenantId = t.id as string;
      const samples = await sampleConversationsForReview({
        tenantId,
        sampleRate: SAMPLE_RATE,
        date,
      });
      if (samples.length === 0) {
        processed++;
        continue;
      }

      const verdicts: Array<{ sample: typeof samples[number]; verdict: Awaited<ReturnType<typeof detectMisclassifiedIntent>> }> = [];
      for (const s of samples) {
        const verdict = await detectMisclassifiedIntent(s);
        verdicts.push({ sample: s, verdict });
      }

      const report = await generateQualityReport({
        tenantId,
        results: verdicts,
        dateFrom: `${date}T00:00:00Z`,
        dateTo: `${date}T23:59:59Z`,
      });

      summaries.push({
        tenant_id: tenantId,
        report,
      });
      processed++;
    } catch (err) {
      console.error('[cron/intent-quality] tenant failed:', err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'intent-quality',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { summaries, date, sample_rate: SAMPLE_RATE },
  });

  return NextResponse.json({ processed, failed, date, duration_ms: Date.now() - start });
}
