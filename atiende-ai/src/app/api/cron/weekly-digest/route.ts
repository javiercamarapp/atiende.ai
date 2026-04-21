// ═════════════════════════════════════════════════════════════════════════════
// CRON — Weekly Digest (Phase 3.D)
//
// Lunes 13:00 UTC (7am America/Merida). Para cada tenant elegible:
//   1. Lee métricas operativas de la semana anterior desde business_health_current
//      + tool_call_logs + appointments.
//   2. Invoca LLM para generar un texto ejecutivo de 4-6 bullets.
//   3. Envía por WhatsApp al owner del tenant.
//   4. Persiste en `digest_history` (UNIQUE por (tenant, week_start)).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { sendTextMessage } from '@/lib/whatsapp/send';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface WeeklyMetrics {
  appointments_booked: number;
  appointments_completed: number;
  appointments_no_show: number;
  appointments_cancelled: number;
  total_revenue_mxn: number;
  revenue_at_risk_mxn: number;
  inbound_messages: number;
  human_handoffs: number;
  tool_calls_total: number;
  tool_calls_failed: number;
}

async function collectTenantMetrics(tenantId: string, weekStart: string, weekEnd: string): Promise<WeeklyMetrics> {
  const [appts, msgs, toolCalls, health] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('status, price_mxn')
      .eq('tenant_id', tenantId)
      .gte('scheduled_at', weekStart)
      .lt('scheduled_at', weekEnd),
    supabaseAdmin
      .from('messages')
      .select('id, direction, conversation_id', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('direction', 'inbound')
      .gte('created_at', weekStart)
      .lt('created_at', weekEnd),
    supabaseAdmin
      .from('tool_call_logs')
      .select('success')
      .eq('tenant_id', tenantId)
      .gte('created_at', weekStart)
      .lt('created_at', weekEnd),
    supabaseAdmin
      .from('business_health_current')
      .select('revenue_at_risk_mxn')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  const apptRows = (appts.data as Array<{ status: string; price_mxn: number | null }>) || [];
  const toolRows = (toolCalls.data as Array<{ success: boolean | null }>) || [];
  const msgCount = msgs.count ?? 0;

  const handoffs = await supabaseAdmin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'human_handoff')
    .gte('last_message_at', weekStart)
    .lt('last_message_at', weekEnd);

  return {
    appointments_booked: apptRows.length,
    appointments_completed: apptRows.filter((a) => a.status === 'completed').length,
    appointments_no_show: apptRows.filter((a) => a.status === 'no_show').length,
    appointments_cancelled: apptRows.filter((a) => a.status === 'cancelled').length,
    total_revenue_mxn: apptRows
      .filter((a) => a.status === 'completed')
      .reduce((s, a) => s + (Number(a.price_mxn) || 0), 0),
    revenue_at_risk_mxn: Number((health.data as { revenue_at_risk_mxn?: number } | null)?.revenue_at_risk_mxn || 0),
    inbound_messages: msgCount,
    human_handoffs: handoffs.count ?? 0,
    tool_calls_total: toolRows.length,
    tool_calls_failed: toolRows.filter((t) => t.success === false).length,
  };
}

async function generateDigestText(businessName: string, metrics: WeeklyMetrics): Promise<{ text: string; cost: number }> {
  const r = await generateResponse({
    model: MODELS.ORCHESTRATOR_FALLBACK,
    system:
      'Eres un asistente ejecutivo. Generas un resumen semanal claro y breve (4-6 bullets, máximo 500 caracteres en total) para el dueño de un negocio en México. Tono profesional y amable. NO uses emojis excesivos — solo uno al principio. Formato: usa "•" como bullet y saltos de línea. En español mexicano.',
    messages: [
      {
        role: 'user',
        content: `Negocio: ${businessName}\n\nMétricas de la semana:\n${JSON.stringify(metrics, null, 2)}\n\nGenera el resumen ejecutivo semanal.`,
      },
    ],
    temperature: 0.4,
    maxTokens: 400,
  });
  return { text: r.text.trim(), cost: r.cost || 0 };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  // Week = últimos 7 días completos
  const weekEndDate = new Date();
  weekEndDate.setUTCHours(0, 0, 0, 0);
  const weekStartDate = new Date(weekEndDate.getTime() - 7 * 24 * 60 * 60_000);
  const weekStart = weekStartDate.toISOString();
  const weekEnd = weekEndDate.toISOString();
  const weekStartDay = weekStart.slice(0, 10);

  const tenants = await listEligibleTenants({ requireFeature: 'weekly_digest' });
  let processed = 0;
  let failed = 0;
  let sent = 0;
  let totalCost = 0;
  const perTenant: Array<Record<string, unknown>> = [];

  // AUDIT R30: paralelizar por chunks con cap de 5. Serial era O(tenants × ~3s
  // por LLM) y bloqueaba maxDuration=300s a >100 tenants. Cap evita saturar
  // rate limits de OpenRouter.
  const CONCURRENCY = 5;
  for (let i = 0; i < tenants.length; i += CONCURRENCY) {
    const chunk = tenants.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (t) => {
        const tenantId = t.id as string;
        const tenantName = (t.name as string) || '';
        const ownerPhone = (t.owner_phone as string) || (t.phone as string) || '';
        const phoneNumberId = t.wa_phone_number_id as string | null;

        try {
          const { data: existing } = await supabaseAdmin
            .from('digest_history')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('week_start', weekStartDay)
            .maybeSingle();
          if (existing) {
            perTenant.push({ tenant_id: tenantId, skipped: 'already_sent' });
            processed++;
            return;
          }

          const metrics = await collectTenantMetrics(tenantId, weekStart, weekEnd);
          const { text, cost } = await generateDigestText(tenantName, metrics);
          totalCost += cost;

          if (ownerPhone && phoneNumberId) {
            try {
              await sendTextMessage(phoneNumberId, ownerPhone, text);
              sent++;
            } catch (sendErr) {
              console.error(`[cron/weekly-digest] send failed for tenant ${tenantId}:`, sendErr);
            }
          }

          await supabaseAdmin.from('digest_history').insert({
            tenant_id: tenantId,
            week_start: weekStartDay,
            digest_text: text,
            cost_usd: cost,
          });

          perTenant.push({ tenant_id: tenantId, metrics, cost_usd: cost });
          processed++;
        } catch (err) {
          console.error(`[cron/weekly-digest] tenant ${tenantId} failed:`, err);
          failed++;
        }
      }),
    );
  }

  await logCronRun({
    jobName: 'weekly-digest',
    startedAt: new Date(start),
    tenantsProcessed: tenants.length,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    totalCostUsd: totalCost,
    details: { week_start: weekStartDay, sent, per_tenant: perTenant },
  });

  if (failed > 0) {
    const { alertOnCronFailure } = await import('@/lib/cron/alert-on-failure');
    await alertOnCronFailure('weekly-digest', tenants.length, failed).catch(() => {});
  }

  return NextResponse.json({
    processed,
    failed,
    sent,
    week_start: weekStartDay,
    total_cost_usd: Number(totalCost.toFixed(6)),
    duration_ms: Date.now() - start,
  });
}
