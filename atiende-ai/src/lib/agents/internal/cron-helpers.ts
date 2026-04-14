// ═════════════════════════════════════════════════════════════════════════════
// CRON HELPERS — Phase 3.D
// Helpers compartidos por todos los crons internos.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runOrchestrator } from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { AGENT_REGISTRY, buildTenantContext, getSystemPrompt } from '@/lib/agents';
import type { AgentName } from '@/lib/agents/types';

/**
 * Verifica el header `Authorization: Bearer ${CRON_SECRET}`.
 * Vercel cron lo añade automáticamente. Retorna NextResponse con 401 si falla;
 * retorna `null` si todo OK (caller continúa).
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Lista los tenants activos elegibles para crons. Filtra por:
 *   - status = 'active'
 *   - features.tool_calling = true (a menos que `requireToolCalling=false`)
 */
export async function listEligibleTenants(opts: {
  requireToolCalling?: boolean;
  requireFeature?: string;
} = {}): Promise<Array<Record<string, unknown>>> {
  const requireToolCalling = opts.requireToolCalling !== false;
  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('status', 'active');
  if (error || !tenants) return [];
  return (tenants as Array<Record<string, unknown>>).filter((t) => {
    const features = (t.features as Record<string, unknown>) || {};
    if (requireToolCalling && features.tool_calling !== true) return false;
    if (opts.requireFeature && features[opts.requireFeature] === false) return false;
    return true;
  });
}

/**
 * Persiste el resultado de un cron run en `cron_runs` para auditoría.
 */
export async function logCronRun(opts: {
  jobName: string;
  startedAt: Date;
  tenantsProcessed: number;
  tenantsSucceeded: number;
  tenantsFailed: number;
  totalCostUsd?: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin.from('cron_runs').insert({
      job_name: opts.jobName,
      started_at: opts.startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      tenants_processed: opts.tenantsProcessed,
      tenants_succeeded: opts.tenantsSucceeded,
      tenants_failed: opts.tenantsFailed,
      total_cost_usd: opts.totalCostUsd ?? 0,
      duration_ms: Date.now() - opts.startedAt.getTime(),
      details: opts.details ?? {},
    });
  } catch {
    /* best effort */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runAgentWorker — ejecuta un agente en modo worker para un tenant
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerRunResult {
  tenant_id: string;
  tenant_name: string;
  success: boolean;
  agent_response?: string;
  error?: string;
  tool_calls_count: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

/**
 * Ejecuta un sub-agente como worker autónomo para UN tenant. Retorna resultado
 * estructurado para agregación en el reporte del cron.
 *
 * El worker no tiene input del paciente — el "user message" es una instrucción
 * sintética (`triggerMessage`) que dispara el flujo del agente.
 */
export async function runAgentWorker(opts: {
  tenant: Record<string, unknown>;
  agentName: AgentName;
  triggerMessage: string;
}): Promise<WorkerRunResult> {
  const { tenant, agentName, triggerMessage } = opts;
  const tenantId = (tenant.id as string) || '';
  const tenantName = (tenant.name as string) || '';
  const tenantCtx = buildTenantContext(tenant);
  const systemPrompt = getSystemPrompt(agentName, tenantCtx);
  const tools = getToolSchemas(AGENT_REGISTRY[agentName].tools);

  try {
    const result = await runOrchestrator({
      tenantId,
      contactId: '',
      conversationId: '',
      customerPhone: '',
      customerName: 'cron-worker',
      tenant,
      businessType: (tenant.business_type as string) || 'other',
      messages: [{ role: 'user', content: triggerMessage }],
      tools,
      systemPrompt,
      agentName,
    });

    // Best-effort: persistir tool_call_logs para observabilidad de dashboard
    if (result.toolCallsExecuted.length > 0) {
      try {
        await supabaseAdmin.from('tool_call_logs').insert(
          result.toolCallsExecuted.map((tc) => ({
            tenant_id: tenantId,
            agent_name: agentName,
            tool_name: tc.toolName,
            args: tc.args,
            result: tc.result,
            duration_ms: tc.durationMs,
            error: tc.error ?? null,
            model_used: result.modelUsed,
            fallback_used: result.fallbackUsed,
          })),
        );
      } catch {
        /* best effort */
      }
    }

    return {
      tenant_id: tenantId,
      tenant_name: tenantName,
      success: true,
      agent_response: result.responseText,
      tool_calls_count: result.toolCallsExecuted.length,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/${agentName}] tenant ${tenantId} (${tenantName}) failed:`, msg);
    return {
      tenant_id: tenantId,
      tenant_name: tenantName,
      success: false,
      error: msg,
      tool_calls_count: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
    };
  }
}

/**
 * Ejecuta un agente como worker across TODOS los tenants elegibles y
 * retorna resultado para respuesta JSON del cron. Recomendado para crons
 * que disparan un único agente (retención, agenda-gap, cobranza, etc).
 */
export async function runAgentWorkerForAllTenants(opts: {
  jobName: string;
  agentName: AgentName;
  triggerMessage: (tenantCtx: { tenantId: string; tomorrowDate: string; currentDatetime: string }) => string;
  /** Feature flag en tenant.features que se revisa además de tool_calling. */
  requireFeature?: string;
}): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  total_tool_calls: number;
  total_cost_usd: number;
  duration_ms: number;
  results: WorkerRunResult[];
}> {
  const start = Date.now();
  const tenants = await listEligibleTenants({ requireFeature: opts.requireFeature });
  const results: WorkerRunResult[] = [];

  for (const tenant of tenants) {
    const ctx = buildTenantContext(tenant);
    const trigger = opts.triggerMessage({
      tenantId: ctx.tenantId,
      tomorrowDate: ctx.tomorrowDate,
      currentDatetime: ctx.currentDatetime,
    });
    const r = await runAgentWorker({ tenant, agentName: opts.agentName, triggerMessage: trigger });
    results.push(r);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  const totalToolCalls = results.reduce((s, r) => s + r.tool_calls_count, 0);
  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);

  await logCronRun({
    jobName: opts.jobName,
    startedAt: new Date(start),
    tenantsProcessed: results.length,
    tenantsSucceeded: succeeded,
    tenantsFailed: failed,
    totalCostUsd: totalCost,
    details: { total_tool_calls: totalToolCalls },
  });

  return {
    processed: results.length,
    succeeded,
    failed,
    total_tool_calls: totalToolCalls,
    total_cost_usd: Number(totalCost.toFixed(6)),
    duration_ms: Date.now() - start,
    results,
  };
}
