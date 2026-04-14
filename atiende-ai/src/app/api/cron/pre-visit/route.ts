// ═════════════════════════════════════════════════════════════════════════════
// CRON — Pre-Visit Instructions (Phase 3.D)
//
// Ejecuta el agente POST-CONSULTA en modo pre-visit: envía instrucciones
// pre-cita a pacientes con cita HOY o MAÑANA (ayuno, documentos, llegada, etc).
// Corre dos veces al día — 07:00 y 17:00 UTC.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth, runAgentWorkerForAllTenants } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/post-consulta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const summary = await runAgentWorkerForAllTenants({
    jobName: 'pre-visit',
    agentName: 'post-consulta',
    requireFeature: 'pre_visit_worker',
    triggerMessage: (ctx) =>
      `Envía instrucciones pre-visita a los pacientes con cita hoy (${ctx.currentDatetime.slice(0, 10)}) o mañana (${ctx.tomorrowDate}) que aún no las hayan recibido.`,
  });
  return NextResponse.json(summary);
}
