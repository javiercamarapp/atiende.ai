// ═════════════════════════════════════════════════════════════════════════════
// CRON — Medication Processing
//
// Corre cada 15 min. Encuentra citas completadas con doctor_notes que todavía
// no procesaron prescripción, invoca al agente `medicamento` que parsea las
// notas y encola recordatorios en scheduled_messages. Marca
// prescription_processed=true para no reprocesar.
//
// Window: completed_at en las últimas 6h. Más allá consideramos que el
// doctor recién subió las notas o el cron estuvo down — preferimos no
// procesar citas viejas automáticamente (si el dueño quiere recuperar
// puede disparar manualmente).
//
// Autenticación: Bearer ${CRON_SECRET}.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runOrchestrator } from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { buildTenantContext } from '@/lib/agents';
import { getMedicamentoPrompt } from '@/lib/agents/medicamento/prompt';
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';
import '@/lib/agents/medicamento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface PendingAppointment {
  id: string;
  tenant_id: string;
  customer_phone: string;
  completed_at: string;
  doctor_notes: string | null;
}

interface TenantRow {
  id: string;
  name: string;
  features: Record<string, unknown> | null;
  wa_phone_number_id: string | null;
  [key: string]: unknown;
}

interface ProcessedResult {
  appointment_id: string;
  tenant_id: string;
  success: boolean;
  error?: string;
  medications_scheduled?: number;
  cost_usd: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  // Window: completed_at en las últimas 6h, con doctor_notes presentes,
  // todavía no procesadas.
  const windowStart = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

  const { data: appointments, error: aptErr } = await supabaseAdmin
    .from('appointments')
    .select('id, tenant_id, customer_phone, completed_at, doctor_notes')
    .eq('status', 'completed')
    .eq('prescription_processed', false)
    .not('doctor_notes', 'is', null)
    .gte('completed_at', windowStart)
    .limit(30);

  if (aptErr) {
    console.error('[cron/medication-processing] query failed:', aptErr.message);
    return NextResponse.json({ error: aptErr.message }, { status: 500 });
  }

  const pending = (appointments || []) as unknown as PendingAppointment[];
  if (pending.length === 0) {
    return NextResponse.json({
      processed: 0,
      message: 'No hay prescripciones pendientes de procesar.',
      duration_ms: Date.now() - start,
    });
  }

  // Defensa: filtrar filas cuyo doctor_notes sea whitespace.
  const withNotes = pending.filter((a) => (a.doctor_notes ?? '').trim().length > 0);

  const tenantIds = Array.from(new Set(withNotes.map((a) => a.tenant_id)));
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('status', 'active')
    .in('id', tenantIds);

  const eligibleTenants = new Map<string, TenantRow>();
  for (const t of (tenants || []) as TenantRow[]) {
    const features = (t.features as Record<string, unknown>) || {};
    if (features.tool_calling !== true) continue;
    if (features.medication_processing === false) continue;
    eligibleTenants.set(t.id, t);
  }

  const tools = getToolSchemas(AGENT_REGISTRY['medicamento'].tools);
  const results: ProcessedResult[] = [];

  for (const apt of withNotes) {
    const tenant = eligibleTenants.get(apt.tenant_id);
    if (!tenant) continue;

    const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);
    const systemPrompt = getMedicamentoPrompt(tenantCtx);

    const triggerMessage = [
      `Procesá la prescripción de esta cita completada.`,
      `appointment_id: ${apt.id}`,
      `patient_phone: ${apt.customer_phone}`,
      `doctor_notes:`,
      '---',
      (apt.doctor_notes || '').trim(),
      '---',
    ].join('\n');

    try {
      const result = await runOrchestrator({
        tenantId: tenant.id,
        contactId: '',
        conversationId: '',
        customerPhone: apt.customer_phone,
        customerName: 'cron-worker',
        tenant: tenant as unknown as Record<string, unknown>,
        businessType: (tenant.business_type as string) || 'other',
        messages: [{ role: 'user', content: triggerMessage }],
        tools,
        systemPrompt,
        agentName: 'medicamento',
      });

      // Inspeccionar si schedule_medication_reminders realmente programó algo.
      // Si el doctor no dejó prescripción o parse falló, marcamos la cita
      // igual como processed (para no reintentar) y simplemente reportamos 0.
      const schedTool = result.toolCallsExecuted.find(
        (tc) => tc.toolName === 'schedule_medication_reminders',
      );
      const medsScheduled =
        schedTool &&
        !schedTool.error &&
        typeof schedTool.result === 'object' &&
        schedTool.result !== null
          ? (schedTool.result as { reminders_scheduled?: number }).reminders_scheduled || 0
          : 0;

      await supabaseAdmin
        .from('appointments')
        .update({
          prescription_processed: true,
          prescription_processed_at: new Date().toISOString(),
        })
        .eq('id', apt.id)
        .eq('tenant_id', tenant.id);

      results.push({
        appointment_id: apt.id,
        tenant_id: tenant.id,
        success: true,
        medications_scheduled: medsScheduled,
        cost_usd: result.costUsd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron/medication-processing] apt ${apt.id} tenant ${tenant.id} failed:`,
        msg,
      );
      results.push({
        appointment_id: apt.id,
        tenant_id: tenant.id,
        success: false,
        error: msg,
        cost_usd: 0,
      });
    }
  }

  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
  try {
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: null,
      action: 'cron.medication_processing.completed',
      entity_type: 'cron',
      details: {
        eligible: withNotes.length,
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
    eligible: withNotes.length,
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    total_cost_usd: Number(totalCost.toFixed(6)),
    duration_ms: Date.now() - start,
  });
}
