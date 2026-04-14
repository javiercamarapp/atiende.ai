// ═════════════════════════════════════════════════════════════════════════════
// CRON — Fraud Detection (Phase 3.D)
//
// Nocturno. Detecta anomalías de volumen (>3x baseline) y prompt injection
// attempts en mensajes inbound del día. Cada hallazgo → fila en `fraud_alerts`.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  detectVolumeAnomalies,
  detectInjectionAttempts,
  generateFraudAlert,
} from '@/lib/agents/internal/fraud-detector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const date = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);

  const anomalies = await detectVolumeAnomalies({ date });
  const injections = await detectInjectionAttempts({ date });

  let alertsInserted = 0;

  for (const a of anomalies) {
    const r = await generateFraudAlert({
      tenant_id: a.tenant_id,
      anomaly_type: `volume_spike_${a.metric}`,
      evidence: `${a.metric} today=${a.today_count} vs baseline_avg_7d=${a.baseline_avg_7d} (×${a.multiplier})`,
    });
    if (r.inserted) alertsInserted++;
  }

  // Group injection attempts by tenant to avoid alert storm
  const injByTenant = new Map<string, typeof injections>();
  for (const i of injections) {
    if (!injByTenant.has(i.tenant_id)) injByTenant.set(i.tenant_id, []);
    injByTenant.get(i.tenant_id)!.push(i);
  }
  for (const [tenantId, items] of injByTenant) {
    const patterns = Array.from(new Set(items.map((i) => i.matched_pattern))).slice(0, 5);
    const r = await generateFraudAlert({
      tenant_id: tenantId,
      anomaly_type: 'prompt_injection',
      evidence: `${items.length} attempts detected. Patterns: ${patterns.join(', ')}`,
    });
    if (r.inserted) alertsInserted++;
  }

  await logCronRun({
    jobName: 'fraud-detection',
    startedAt: new Date(start),
    tenantsProcessed: anomalies.length + injByTenant.size,
    tenantsSucceeded: alertsInserted,
    tenantsFailed: 0,
    details: {
      date,
      volume_anomalies: anomalies.length,
      injection_attempts: injections.length,
      alerts_inserted: alertsInserted,
    },
  });

  return NextResponse.json({
    date,
    volume_anomalies: anomalies.length,
    injection_attempts: injections.length,
    alerts_inserted: alertsInserted,
    duration_ms: Date.now() - start,
  });
}
