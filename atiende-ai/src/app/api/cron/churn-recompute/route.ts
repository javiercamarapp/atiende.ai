// ═════════════════════════════════════════════════════════════════════════════
// CRON — Churn score nightly recompute (Phase 3)
//
// Llama recompute_churn_scores_for_tenant() para cada tenant activo. La
// función Postgres ya hace el batch update con multi-signal heuristic.
// El agente `retencion` luego lee contacts.churn_probability como antes.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = new Date();
  const tenants = await listEligibleTenants({ requireToolCalling: false });

  let processed = 0;
  let failed = 0;
  let totalContacts = 0;

  for (const t of tenants) {
    const tenantId = t.id as string;
    try {
      const { data, error } = await supabaseAdmin.rpc('recompute_churn_scores_for_tenant', {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      const updated = Number(data ?? 0);
      totalContacts += updated;
      processed++;
    } catch (err) {
      console.error('[cron/churn-recompute] tenant failed:', tenantId, err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'churn-recompute',
    startedAt: start,
    tenantsProcessed: processed + failed,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { contacts_updated: totalContacts },
  });

  return NextResponse.json({
    ok: true,
    tenants_processed: processed,
    tenants_failed: failed,
    contacts_updated: totalContacts,
  });
}
