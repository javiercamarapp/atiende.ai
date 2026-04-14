// ═════════════════════════════════════════════════════════════════════════════
// CRON — Prompt Fine-Tuning (Phase 3.D)
//
// Semanal (domingo 23:00 UTC). Identifica conversaciones fallidas y genera
// propuestas de mejora del prompt con LLM. Las encola en
// `prompt_approval_queue` para que Javier las apruebe antes de desplegar.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  identifyFailedConversations,
  generatePromptImprovement,
  queueForApproval,
} from '@/lib/agents/internal/prompt-fine-tuning';

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
      const failures = await identifyFailedConversations({ tenantId, dateFrom });
      if (failures.length < 3) {
        processed++;
        continue;
      }

      // Group by agent_name
      const byAgent = new Map<string, typeof failures>();
      for (const f of failures) {
        if (!byAgent.has(f.agent_name)) byAgent.set(f.agent_name, []);
        byAgent.get(f.agent_name)!.push(f);
      }

      let queued = 0;
      for (const [agentName, convs] of byAgent) {
        if (convs.length < 3 || agentName === 'unknown') continue;

        // Fetch current prompt from tenant_prompts
        const { data: existing } = await supabaseAdmin
          .from('tenant_prompts')
          .select('prompt_text')
          .eq('tenant_id', tenantId)
          .eq('agent_name', agentName)
          .eq('is_active', true)
          .maybeSingle();

        const currentPrompt =
          (existing?.prompt_text as string) || `[Prompt base del agente ${agentName}]`;

        const improvement = await generatePromptImprovement({
          agentName,
          currentPrompt,
          failedConversations: convs,
          failurePatterns: Array.from(new Set(convs.map((c) => c.failure_reason))),
        });

        if (improvement.new_prompt && improvement.new_prompt !== currentPrompt) {
          const r = await queueForApproval({
            tenantId,
            agentName,
            currentPrompt,
            proposedPrompt: improvement.new_prompt,
            changesSummary: improvement.changes_summary,
          });
          if (r.queued) queued++;
        }
      }

      summaries.push({ tenant_id: tenantId, failures: failures.length, queued });
      processed++;
    } catch (err) {
      console.error('[cron/prompt-finetuning] tenant failed:', err);
      failed++;
    }
  }

  await logCronRun({
    jobName: 'prompt-finetuning',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { summaries, date_from: dateFrom },
  });

  return NextResponse.json({ processed, failed, duration_ms: Date.now() - start });
}
