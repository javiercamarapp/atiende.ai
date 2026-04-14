// ═════════════════════════════════════════════════════════════════════════════
// CRON — No-Show Reminders (Phase 2.B.4)
//
// Corre todos los días a las 00:00 UTC = 18:00 America/Merida (UTC-6).
// Itera sobre tenants con `features.tool_calling=true` y `status='active'`, y
// para cada uno invoca al agente NO-SHOW como worker autónomo. El agente
// recibe la lista de citas de MAÑANA y dispara recordatorios por WhatsApp.
//
// Autenticación: header `Authorization: Bearer ${CRON_SECRET}` obligatorio.
// Vercel cron jobs añaden este header automáticamente si la env var existe.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runOrchestrator } from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { buildTenantContext } from '@/lib/agents';
import { getNoShowPrompt } from '@/lib/agents/no-show/prompt';
import { AGENT_REGISTRY } from '@/lib/agents/registry';

// Side-effect import — asegura que las tools de no-show estén registradas
// cuando corre el handler del cron (los imports de agents/* lo hacen también,
// pero somos explícitos aquí para no depender del orden de evaluación).
import '@/lib/agents/no-show';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El worker puede tardar — enviar N templates + procesar respuestas LLM.
// 300s es el máximo de Vercel Pro, suficiente para ~50 tenants x ~20 citas c/u.
export const maxDuration = 300;

interface TenantRow {
  id: string;
  name: string;
  timezone: string | null;
  features: Record<string, unknown> | null;
  wa_phone_number_id: string | null;
  [key: string]: unknown;
}

interface TenantResult {
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  // ── 1. Auth — Vercel cron manda Bearer con CRON_SECRET ───────────────────
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  // ── 2. Tenants elegibles ─────────────────────────────────────────────────
  //    - status = 'active'
  //    - features.tool_calling = true
  //    - features.no_show_worker !== false (default true)
  //    - wa_phone_number_id configurado
  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('status', 'active')
    .not('wa_phone_number_id', 'is', null);

  if (tenantsErr) {
    console.error('[cron/no-show] tenants query failed:', tenantsErr.message);
    return NextResponse.json(
      { error: 'Tenants query failed', message: tenantsErr.message },
      { status: 500 },
    );
  }

  const eligible = (tenants || []).filter((t) => {
    const features = (t.features as Record<string, unknown>) || {};
    if (features.tool_calling !== true) return false;
    if (features.no_show_worker === false) return false;
    return true;
  }) as TenantRow[];

  if (eligible.length === 0) {
    return NextResponse.json({
      processed: 0,
      message: 'No tenants with tool_calling + no_show_worker enabled.',
      duration_ms: Date.now() - start,
    });
  }

  // ── 3. Procesar cada tenant secuencialmente ──────────────────────────────
  //    Paralelizar podría saturar el rate-limit de OpenRouter/WhatsApp; el
  //    cron tiene 300s de presupuesto, suficiente para decenas de tenants.
  const results: TenantResult[] = [];
  const tools = getToolSchemas(AGENT_REGISTRY['no-show'].tools);

  for (const tenant of eligible) {
    const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);
    const systemPrompt = getNoShowPrompt(tenantCtx);

    // El worker no tiene input del paciente — el "user message" es una
    // instrucción sintética que dispara el flujo.
    const triggerMessage = `Procesa las citas de mañana (${tenantCtx.tomorrowDate}) para este tenant.`;

    try {
      const result = await runOrchestrator({
        tenantId: tenant.id,
        contactId: '', // worker no actúa sobre un contact específico
        conversationId: '', // no es conversación
        customerPhone: '',
        customerName: 'cron-worker',
        tenant: tenant as unknown as Record<string, unknown>,
        businessType: (tenant.business_type as string) || 'other',
        messages: [{ role: 'user', content: triggerMessage }],
        tools,
        systemPrompt,
        agentName: 'no-show',
      });

      results.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        success: true,
        agent_response: result.responseText,
        tool_calls_count: result.toolCallsExecuted.length,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      });

      // Log each tool call to tool_call_logs for dashboard visibility
      if (result.toolCallsExecuted.length > 0) {
        try {
          await supabaseAdmin.from('tool_call_logs').insert(
            result.toolCallsExecuted.map((tc) => ({
              tenant_id: tenant.id,
              agent_name: 'no-show',
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron/no-show] tenant ${tenant.id} (${tenant.name}) failed:`,
        msg,
      );
      results.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        success: false,
        error: msg,
        tool_calls_count: 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
      });
    }
  }

  // ── 4. Audit log del cron run (best effort) ──────────────────────────────
  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
  const totalToolCalls = results.reduce((s, r) => s + r.tool_calls_count, 0);

  try {
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: null,
      action: 'cron.no_show_reminders.completed',
      entity_type: 'cron',
      details: {
        processed: results.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        total_tool_calls: totalToolCalls,
        total_cost_usd: totalCost,
        duration_ms: Date.now() - start,
      },
    });
  } catch {
    /* best effort */
  }

  // Alert Javier si hubo fallos
  const failedCount = results.filter((r) => !r.success).length;
  if (failedCount > 0) {
    const { alertOnCronFailure } = await import('@/lib/cron/alert-on-failure');
    await alertOnCronFailure(
      'no-show-reminders',
      results.length,
      failedCount,
      results.find((r) => !r.success)?.error,
    ).catch(() => {});
  }

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: failedCount,
    total_tool_calls: totalToolCalls,
    total_cost_usd: Number(totalCost.toFixed(6)),
    duration_ms: Date.now() - start,
    results,
  });
}
