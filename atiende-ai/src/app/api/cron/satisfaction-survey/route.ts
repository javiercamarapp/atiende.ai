// ═════════════════════════════════════════════════════════════════════════════
// CRON — Satisfaction Survey
//
// Corre cada 30 minutos. Encuentra citas completadas hace 90 min a 3 h que
// todavía no tienen survey enviado, y para cada una invoca al agente
// `encuesta` en modo outbound (el agente llama send_satisfaction_survey y
// setea AWAITING_SURVEY_RESPONSE en la conversación del paciente, de modo
// que cuando el paciente responda, el orchestrator-branch rutee al mismo
// agente para parsear la respuesta).
//
// Window de 90 min–3 h:
//   - 90 min: esperar a que el paciente salga del consultorio y tenga
//     tiempo de reflexionar sobre la atención. Mandar antes se siente
//     intrusivo.
//   - 3 h: cap para no molestar si el paciente ya pasó al siguiente tema
//     del día. Citas que queden fuera del window (cron caído > 3h)
//     quedan sin encuesta — es degradación aceptable, no duplicamos.
//
// Autenticación: Bearer ${CRON_SECRET}.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runOrchestrator } from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { buildTenantContext } from '@/lib/agents';
import { getEncuestaPrompt } from '@/lib/agents/encuesta/prompt';
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/encuesta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface PendingAppointment {
  id: string;
  tenant_id: string;
  customer_phone: string;
  customer_name: string | null;
  datetime: string;
  completed_at: string;
  staff: { name: string | null } | { name: string | null }[] | null;
}

interface TenantRow {
  id: string;
  name: string;
  timezone: string | null;
  features: Record<string, unknown> | null;
  wa_phone_number_id: string | null;
  [key: string]: unknown;
}

interface ProcessedResult {
  appointment_id: string;
  tenant_id: string;
  success: boolean;
  error?: string;
  tool_calls_count: number;
  cost_usd: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  // ── 1. Fetch appointments elegibles (cross-tenant, tool_calling=true) ───
  // Window: completadas entre 90min y 3h atrás, todavía sin survey.
  const windowStart = new Date(Date.now() - 3 * 60 * 60_000).toISOString(); // -3h
  const windowEnd = new Date(Date.now() - 90 * 60_000).toISOString();       // -90min

  const { data: appointments, error: aptErr } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, tenant_id, customer_phone, customer_name, datetime, completed_at, staff:staff_id(name)',
    )
    .eq('status', 'completed')
    .eq('survey_sent', false)
    .gte('completed_at', windowStart)
    .lte('completed_at', windowEnd)
    .limit(50);

  if (aptErr) {
    console.error('[cron/satisfaction-survey] query failed:', aptErr.message);
    return NextResponse.json({ error: aptErr.message }, { status: 500 });
  }

  const pending = (appointments || []) as unknown as PendingAppointment[];
  if (pending.length === 0) {
    return NextResponse.json({
      processed: 0,
      message: 'No hay citas elegibles en el window.',
      duration_ms: Date.now() - start,
    });
  }

  // ── 2. Agrupar por tenant y filtrar por tool_calling ────────────────────
  const byTenant = new Map<string, PendingAppointment[]>();
  for (const apt of pending) {
    const arr = byTenant.get(apt.tenant_id) || [];
    arr.push(apt);
    byTenant.set(apt.tenant_id, arr);
  }

  const tenantIds = Array.from(byTenant.keys());
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('status', 'active')
    .in('id', tenantIds);

  const eligibleTenants = new Map<string, TenantRow>();
  for (const t of (tenants || []) as TenantRow[]) {
    const features = (t.features as Record<string, unknown>) || {};
    if (features.tool_calling !== true) continue;
    if (features.satisfaction_survey === false) continue; // opt-out explícito
    if (!t.wa_phone_number_id) continue;
    eligibleTenants.set(t.id, t);
  }

  const tools = getToolSchemas(AGENT_REGISTRY['encuesta'].tools);
  const results: ProcessedResult[] = [];

  // ── 3. Procesar cada appointment secuencialmente ────────────────────────
  for (const apt of pending) {
    const tenant = eligibleTenants.get(apt.tenant_id);
    if (!tenant) continue; // tenant opt-out o sin tool_calling — skip silencioso

    const staffObj = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
    const doctorName = staffObj?.name || 'el doctor';
    const patientName = apt.customer_name || 'paciente';

    const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);
    const systemPrompt = getEncuestaPrompt(tenantCtx);

    const triggerMessage = [
      `Enviá la encuesta de satisfacción (MODO A — OUTBOUND) a este paciente.`,
      `appointment_id: ${apt.id}`,
      `patient_phone: ${apt.customer_phone}`,
      `patient_name: ${patientName}`,
      `doctor_name: ${doctorName}`,
    ].join('\n');

    try {
      const result = await runOrchestrator({
        tenantId: tenant.id,
        contactId: '',
        conversationId: '',
        customerPhone: apt.customer_phone,
        customerName: patientName,
        tenant: tenant as unknown as Record<string, unknown>,
        businessType: (tenant.business_type as string) || 'other',
        messages: [{ role: 'user', content: triggerMessage }],
        tools,
        systemPrompt,
        agentName: 'encuesta',
      });

      // Marcar survey_sent=true solo si send_satisfaction_survey reportó sent:true.
      const sentTool = result.toolCallsExecuted.find(
        (tc) => tc.toolName === 'send_satisfaction_survey',
      );
      const sendOk =
        sentTool &&
        !sentTool.error &&
        typeof sentTool.result === 'object' &&
        sentTool.result !== null &&
        (sentTool.result as { sent?: boolean }).sent === true;

      if (sendOk) {
        await supabaseAdmin
          .from('appointments')
          .update({
            survey_sent: true,
            survey_sent_at: new Date().toISOString(),
          })
          .eq('id', apt.id)
          .eq('tenant_id', tenant.id);
      }

      results.push({
        appointment_id: apt.id,
        tenant_id: tenant.id,
        success: Boolean(sendOk),
        tool_calls_count: result.toolCallsExecuted.length,
        cost_usd: result.costUsd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron/satisfaction-survey] apt ${apt.id} tenant ${tenant.id} failed:`,
        msg,
      );
      results.push({
        appointment_id: apt.id,
        tenant_id: tenant.id,
        success: false,
        error: msg,
        tool_calls_count: 0,
        cost_usd: 0,
      });
    }
  }

  // ── 4. Audit ────────────────────────────────────────────────────────────
  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
  try {
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: null,
      action: 'cron.satisfaction_survey.completed',
      entity_type: 'cron',
      details: {
        eligible: pending.length,
        processed: results.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        total_cost_usd: totalCost,
        duration_ms: Date.now() - start,
      },
    });
  } catch {
    /* best effort */
  }

  return NextResponse.json({
    eligible: pending.length,
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    total_cost_usd: Number(totalCost.toFixed(6)),
    duration_ms: Date.now() - start,
  });
}
