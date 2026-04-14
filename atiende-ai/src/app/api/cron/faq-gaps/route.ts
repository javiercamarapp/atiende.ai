// ═════════════════════════════════════════════════════════════════════════════
// CRON — FAQ Gap Detector (Phase 3.D)
//
// Semanal (lunes 06:00 UTC = domingo 00:00 America/Merida). Detecta preguntas
// frecuentes que acaban en escalamiento humano, las clusteriza y propone FAQs.
// Las sugerencias quedan en `benchmark_metrics` tipo 'faq_suggestion' para que
// Javier las revise y las promueva al registry de FAQ.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  getUnansweredQuestions,
  clusterSimilarQuestions,
  generateFAQSuggestions,
} from '@/lib/agents/internal/faq-gap-detector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const tenants = await listEligibleTenants({ requireToolCalling: false });

  let processed = 0;
  let failed = 0;
  const summaries: Array<Record<string, unknown>> = [];

  for (const t of tenants) {
    try {
      const tenantId = t.id as string;
      const questions = await getUnansweredQuestions({ tenantId, dateFrom });
      if (questions.length < 3) {
        processed++;
        continue;
      }

      const clusters = clusterSimilarQuestions(questions.map((q) => q.content));
      const suggestions = await generateFAQSuggestions(clusters);

      // Las sugerencias viven en cron_runs.details para que Javier las revise.
      summaries.push({
        tenant_id: tenantId,
        questions: questions.length,
        clusters: clusters.length,
        suggestions,
      });
      processed++;
    } catch (err) {
      console.error('[cron/faq-gaps] tenant failed:', err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'faq-gaps',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { summaries, date_from: dateFrom },
  });

  return NextResponse.json({ processed, failed, date_from: dateFrom, duration_ms: Date.now() - start });
}
