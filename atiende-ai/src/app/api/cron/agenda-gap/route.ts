// ═════════════════════════════════════════════════════════════════════════════
// CRON — Agenda Gap Filler (Phase 3.D)
//
// Detecta huecos en la agenda de los próximos 3 días y propone esos slots a
// pacientes elegibles (post-consulta reciente, próximo chequeo pendiente).
// Corre diario a las 14:00 UTC (8am America/Merida).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth, runAgentWorkerForAllTenants } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/agenda-gap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const summary = await runAgentWorkerForAllTenants({
    jobName: 'agenda-gap',
    agentName: 'agenda-gap',
    requireFeature: 'agenda_gap_worker',
    triggerMessage: () =>
      'Detecta huecos de agenda en los próximos 3 días y ofrece esos slots a los pacientes candidatos.',
  });
  return NextResponse.json(summary);
}
