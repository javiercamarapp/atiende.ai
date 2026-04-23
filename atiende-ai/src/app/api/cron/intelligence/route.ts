// ═════════════════════════════════════════════════════════════════════════════
// CRON — Intelligence Batch (Phase 3.E / P0-P1)
//
// Nocturno (09:00 UTC = 03:00 America/Merida). Para cada tenant activo con
// features.tool_calling = true recalcula los scores de todos sus contacts,
// refresca predicciones de no-show para el día siguiente, refresca la
// materialized view business_health_current, y dispara el análisis LLM de
// conversaciones recientes (resumen, insatisfacción, motivo de cancelación).
//
// El cron NO envía mensajes — solo computa. Los workers que envían WhatsApp
// (no-show, pre-visit, retention, etc.) corren en sus propios crons.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import {
  classifyCancellationReason,
  generateConversationSummary,
  detectUnsatisfiedPatient,
} from '@/lib/intelligence/conversation-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface TenantIntelligenceResult {
  tenant_id: string;
  tenant_name: string;
  contacts_scored: number;
  appointments_risk_refreshed: number;
  conversations_summarized: number;
  unsatisfaction_flags: number;
  cancellation_classified: number;
  error?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  const tenants = await listEligibleTenants();
  // Paralelizar tenants — con 10 tenants x 5 sub-tasks el loop serial
  // llegaba a ~300s (timeout de Vercel). allSettled nunca falla el cron por
  // un tenant roto; los errores se agregan al summary.
  const settled = await Promise.allSettled(
    tenants.map((tenant) => processTenant(tenant)),
  );
  const results: TenantIntelligenceResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const tenant = tenants[i] as Record<string, unknown> | undefined;
    return {
      tenant_id: (tenant?.id as string) || 'unknown',
      tenant_name: (tenant?.name as string) || 'unknown',
      contacts_scored: 0,
      appointments_risk_refreshed: 0,
      conversations_summarized: 0,
      unsatisfaction_flags: 0,
      cancellation_classified: 0,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  // Refresh materialized view UNA sola vez al final (más eficiente que por tenant)
  let viewRefreshed = false;
  let viewRefreshError: string | undefined;
  try {
    const { error } = await supabaseAdmin.rpc('refresh_business_health');
    if (error) viewRefreshError = error.message;
    else viewRefreshed = true;
  } catch (err) {
    viewRefreshError = err instanceof Error ? err.message : String(err);
  }

  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.length - succeeded;

  if (failed > 0) {
    const { alertOnCronFailure } = await import('@/lib/cron/alert-on-failure');
    await alertOnCronFailure(
      'intelligence',
      results.length,
      failed,
      results.find((r) => r.error)?.error,
    ).catch(() => {});
  }

  await logCronRun({
    jobName: 'intelligence',
    startedAt: new Date(start),
    tenantsProcessed: results.length,
    tenantsSucceeded: succeeded,
    tenantsFailed: failed,
    details: {
      per_tenant: results,
      materialized_view_refreshed: viewRefreshed,
      materialized_view_error: viewRefreshError,
    },
  });

  return NextResponse.json({
    processed: results.length,
    succeeded,
    failed,
    materialized_view_refreshed: viewRefreshed,
    duration_ms: Date.now() - start,
    results,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// processTenant — procesa un tenant end-to-end
// ─────────────────────────────────────────────────────────────────────────────

async function processTenant(
  tenant: Record<string, unknown>,
): Promise<TenantIntelligenceResult> {
  const tenantId = (tenant.id as string) || '';
  const tenantName = (tenant.name as string) || '';

  const out: TenantIntelligenceResult = {
    tenant_id: tenantId,
    tenant_name: tenantName,
    contacts_scored: 0,
    appointments_risk_refreshed: 0,
    conversations_summarized: 0,
    unsatisfaction_flags: 0,
    cancellation_classified: 0,
  };

  try {
    // 1. Recalcular scores de TODOS los contacts del tenant
    out.contacts_scored = await rescoreAllContacts(tenantId);

    // 2. Refrescar no_show_risk_score para citas del día siguiente
    out.appointments_risk_refreshed = await refreshTomorrowRiskScores(tenantId);

    // 3. LLM: resumir conversaciones cerradas en últimas 24h
    out.conversations_summarized = await summarizeRecentConversations(tenantId);

    // 4. LLM: detectar insatisfacción en conversaciones activas con >3 mensajes
    out.unsatisfaction_flags = await detectUnsatisfiedConversations(tenantId);

    // 5. LLM: clasificar motivo de citas canceladas HOY
    out.cancellation_classified = await classifyTodayCancellations(tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/intelligence] tenant ${tenantId} failed:`, msg);
    out.error = msg;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tareas
// ─────────────────────────────────────────────────────────────────────────────

async function rescoreAllContacts(tenantId: string): Promise<number> {
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId);

  if (!contacts || contacts.length === 0) return 0;

  let scored = 0;
  for (const c of contacts) {
    const contactId = c.id as string;
    try {
      const [health, churn, nextVisit, ltv] = await Promise.all([
        supabaseAdmin.rpc('calculate_patient_health_score', { p_contact_id: contactId }),
        supabaseAdmin.rpc('calculate_churn_probability', { p_contact_id: contactId }),
        supabaseAdmin.rpc('calculate_next_visit_prediction', { p_contact_id: contactId }),
        supabaseAdmin.rpc('calculate_lifetime_value', { p_contact_id: contactId }),
      ]);

      const update: Record<string, unknown> = {};
      if (typeof health.data === 'number') update.health_score = health.data;
      if (typeof churn.data === 'number') update.churn_probability = churn.data;
      if (nextVisit.data) update.next_visit_predicted_at = nextVisit.data;
      if (typeof ltv.data === 'number') update.lifetime_value_mxn = ltv.data;

      if (Object.keys(update).length > 0) {
        await supabaseAdmin.from('contacts').update(update).eq('id', contactId);
        scored++;
      }
    } catch {
      /* skip contact on individual error */
    }
  }
  return scored;
}

async function refreshTomorrowRiskScores(tenantId: string): Promise<number> {
  const now = new Date();
  const tomorrowStart = new Date(now);
  tomorrowStart.setUTCDate(now.getUTCDate() + 1);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60_000);

  const { data: apts } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('status', ['scheduled', 'confirmed'])
    .gte('datetime', tomorrowStart.toISOString())
    .lt('datetime', tomorrowEnd.toISOString());

  if (!apts || apts.length === 0) return 0;

  let refreshed = 0;
  for (const a of apts) {
    try {
      const { data: score } = await supabaseAdmin.rpc('calculate_no_show_risk', {
        p_appointment_id: a.id,
      });
      if (typeof score === 'number') {
        await supabaseAdmin
          .from('appointments')
          .update({ no_show_risk_score: score })
          .eq('id', a.id);
        refreshed++;
      }
    } catch {
      /* skip */
    }
  }
  return refreshed;
}

async function summarizeRecentConversations(tenantId: string): Promise<number> {
  const cutoff2h = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  // Conversaciones con actividad en últimas 24h PERO sin mensajes en las últimas
  // 2h (asumimos "cerradas") Y sin summary aún
  const { data: convs } = await supabaseAdmin
    .from('conversations')
    .select('id, last_message_at, summary')
    .eq('tenant_id', tenantId)
    .gte('last_message_at', cutoff24h)
    .lt('last_message_at', cutoff2h)
    .is('summary', null)
    .limit(50);

  if (!convs || convs.length === 0) return 0;

  let summarized = 0;
  for (const c of convs) {
    const result = await generateConversationSummary(c.id as string);
    if (result) summarized++;
  }
  return summarized;
}

async function detectUnsatisfiedConversations(tenantId: string): Promise<number> {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  // Conversaciones ACTIVAS (no human_handoff, no closed) en últimas 24h
  const { data: convs } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .not('status', 'in', '(human_handoff,closed)')
    .gte('last_message_at', cutoff24h)
    .limit(30);

  if (!convs || convs.length === 0) return 0;

  // Reemplaza N queries COUNT por conversación por UNA sola query que trae
  // todos los `conversation_id` de mensajes recientes y cuenta en memoria.
  // Con 30 convs x ~50 msgs cada = 1500 rows, es trivial.
  const conversationIds = convs.map((c) => c.id as string);
  const { data: recentMessages } = await supabaseAdmin
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds);

  const countMap = new Map<string, number>();
  for (const m of (recentMessages || []) as Array<{ conversation_id: string }>) {
    countMap.set(m.conversation_id, (countMap.get(m.conversation_id) || 0) + 1);
  }

  let flags = 0;
  for (const c of convs) {
    const cid = c.id as string;
    if ((countMap.get(cid) || 0) <= 3) continue;
    const r = await detectUnsatisfiedPatient(cid);
    if (r.unsatisfied) flags++;
  }
  return flags;
}

async function classifyTodayCancellations(tenantId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  // Citas canceladas HOY que aún no tienen cancellation_reason clasificada
  // (o tienen texto libre que queremos normalizar al enum)
  const { data: apts } = await supabaseAdmin
    .from('appointments')
    .select('id, customer_phone')
    .eq('tenant_id', tenantId)
    .eq('status', 'cancelled')
    .gte('cancelled_at', dayStart.toISOString());

  if (!apts || apts.length === 0) return 0;

  // Reemplaza N queries por paciente por UNA query que trae todas las
  // conversations de los phones relevantes, ordenadas por last_message_at
  // desc. Luego armamos map phone -> conversation_id (latest).
  const phones = Array.from(new Set(
    (apts as Array<{ customer_phone: string }>).map((a) => a.customer_phone).filter(Boolean),
  ));
  const phoneToConvId = new Map<string, string>();
  if (phones.length > 0) {
    const { data: convs } = await supabaseAdmin
      .from('conversations')
      .select('id, customer_phone, last_message_at')
      .eq('tenant_id', tenantId)
      .in('customer_phone', phones)
      .order('last_message_at', { ascending: false });

    // `order` es DESC, con in() Supabase retorna todas en ese orden — cuando
    // vemos un phone por primera vez, esa es la conversación más reciente.
    for (const c of (convs || []) as Array<{ id: string; customer_phone: string }>) {
      if (!phoneToConvId.has(c.customer_phone)) {
        phoneToConvId.set(c.customer_phone, c.id);
      }
    }
  }

  let classified = 0;
  for (const a of apts) {
    const convId = phoneToConvId.get(a.customer_phone as string);
    if (!convId) continue;
    const r = await classifyCancellationReason(convId, a.id as string);
    if (r.confidence > 0) classified++;
  }
  return classified;
}
