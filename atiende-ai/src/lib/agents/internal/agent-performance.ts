// ═════════════════════════════════════════════════════════════════════════════
// AGENT PERFORMANCE TRACKER — Phase 3.C
// Calcula métricas por agente y tenant a partir de tool_call_logs.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface AgentMetrics {
  tenant_id: string;
  agent_name: string;
  total_invocations: number;
  resolution_rate_pct: number;
  avg_response_ms: number;
  error_rate_pct: number;
  fallback_rate_pct: number;
  conversion_rate_pct: number; // intents que terminaron en cita
  total_cost_usd: number;
  date_from: string;
  date_to: string;
}

export interface FailingTool {
  tool_name: string;
  error_count: number;
  last_error_message: string;
}

/**
 * Calcula métricas agregadas para todos los agentes de un tenant en una
 * ventana de fechas. Reads `tool_call_logs`.
 */
export async function calculateAgentMetrics(opts: {
  tenantId: string;
  dateFrom: string; // ISO
  dateTo: string;   // ISO
}): Promise<AgentMetrics[]> {
  const { data: logs, error } = await supabaseAdmin
    .from('tool_call_logs')
    .select('agent_name, tool_name, success, duration_ms, fallback_used')
    .eq('tenant_id', opts.tenantId)
    .gte('created_at', opts.dateFrom)
    .lte('created_at', opts.dateTo);

  if (error || !logs) return [];

  const byAgent = new Map<
    string,
    {
      total: number;
      errors: number;
      durations: number[];
      fallbacks: number;
      conversions: number; // proxy: tools de booking exitosas
    }
  >();

  const bookingTools = new Set([
    'book_appointment',
    'modify_appointment',
    'cancel_appointment',
  ]);

  for (const r of logs) {
    const agent = (r.agent_name as string) || 'unknown';
    if (!byAgent.has(agent)) {
      byAgent.set(agent, { total: 0, errors: 0, durations: [], fallbacks: 0, conversions: 0 });
    }
    const m = byAgent.get(agent)!;
    m.total += 1;
    if (r.success === false) m.errors += 1;
    if (typeof r.duration_ms === 'number') m.durations.push(r.duration_ms);
    if (r.fallback_used === true) m.fallbacks += 1;
    if (r.success === true && bookingTools.has(r.tool_name as string)) m.conversions += 1;
  }

  const out: AgentMetrics[] = [];
  for (const [agent, m] of byAgent) {
    const avg =
      m.durations.length > 0
        ? Math.round(m.durations.reduce((a, b) => a + b, 0) / m.durations.length)
        : 0;
    out.push({
      tenant_id: opts.tenantId,
      agent_name: agent,
      total_invocations: m.total,
      resolution_rate_pct: m.total > 0 ? Math.round((100 * (m.total - m.errors)) / m.total) : 0,
      avg_response_ms: avg,
      error_rate_pct: m.total > 0 ? Math.round((100 * m.errors) / m.total) : 0,
      fallback_rate_pct: m.total > 0 ? Math.round((100 * m.fallbacks) / m.total) : 0,
      conversion_rate_pct: m.total > 0 ? Math.round((100 * m.conversions) / m.total) : 0,
      total_cost_usd: 0, // tool_call_logs no rastrea cost; viene de `messages`
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
    });
  }
  return out;
}

/**
 * Top tools que fallan más para un tenant. Útil para priorizar fixes.
 */
export async function getTopFailingTools(opts: {
  tenantId: string;
  limit: number;
}): Promise<FailingTool[]> {
  const { data, error } = await supabaseAdmin
    .from('tool_call_logs')
    .select('tool_name, error_message')
    .eq('tenant_id', opts.tenantId)
    .eq('success', false)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data) return [];
  const counts = new Map<string, { count: number; lastErr: string }>();
  for (const r of data) {
    const t = (r.tool_name as string) || 'unknown';
    if (!counts.has(t)) counts.set(t, { count: 0, lastErr: '' });
    const m = counts.get(t)!;
    m.count += 1;
    if (!m.lastErr && r.error_message) m.lastErr = r.error_message as string;
  }
  return Array.from(counts.entries())
    .map(([tool_name, v]) => ({
      tool_name,
      error_count: v.count,
      last_error_message: v.lastErr,
    }))
    .sort((a, b) => b.error_count - a.error_count)
    .slice(0, opts.limit);
}
