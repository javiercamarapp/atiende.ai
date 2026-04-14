// ═════════════════════════════════════════════════════════════════════════════
// CRON — Cobranza Worker (Phase 3.D)
//
// Envía recordatorios de pago escalados por días vencidos. Corre semanal los
// lunes a las 15:00 UTC (9am America/Merida) para empezar la semana con cobros.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth, runAgentWorkerForAllTenants } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/cobranza';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const summary = await runAgentWorkerForAllTenants({
    jobName: 'cobranza',
    agentName: 'cobranza',
    requireFeature: 'cobranza_worker',
    triggerMessage: () =>
      'Procesa la lista de pagos pendientes vencidos y envía los recordatorios escalados por antigüedad.',
  });
  return NextResponse.json(summary);
}
