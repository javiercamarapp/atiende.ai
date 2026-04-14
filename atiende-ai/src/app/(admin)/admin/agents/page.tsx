// ─────────────────────────────────────────────────────────────────────────────
// Admin Agents — performance por agente sobre tool_call_logs
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';
import { AGENT_REGISTRY } from '@/lib/agents/registry';

export const dynamic = 'force-dynamic';

interface ToolLogRow {
  agent_name: string | null;
  tool_name: string | null;
  success: boolean | null;
  duration_ms: number | null;
  tenant_id: string | null;
  error_message: string | null;
}

interface AgentStats {
  agent: string;
  total: number;
  success: number;
  success_rate: number;
  avg_duration_ms: number;
  top_failing: Array<{ tool: string; errors: number; lastMsg: string }>;
  tenants_count: number;
}

async function loadAgentStats(): Promise<AgentStats[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('tool_call_logs')
    .select('agent_name, tool_name, success, duration_ms, tenant_id, error_message')
    .gte('created_at', sevenDaysAgo)
    .limit(10_000);

  const rows = (data as ToolLogRow[] | null) || [];
  const byAgent = new Map<string, ToolLogRow[]>();
  for (const r of rows) {
    const a = r.agent_name || 'unknown';
    if (!byAgent.has(a)) byAgent.set(a, []);
    byAgent.get(a)!.push(r);
  }

  const agentNames = Object.keys(AGENT_REGISTRY);

  return agentNames.map((agent) => {
    const items = byAgent.get(agent) || [];
    const total = items.length;
    const success = items.filter((r) => r.success !== false).length;
    const durations = items.map((r) => r.duration_ms).filter((d): d is number => typeof d === 'number');
    const avg = durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0;

    const failingMap = new Map<string, { count: number; last: string }>();
    for (const r of items) {
      if (r.success === false && r.tool_name) {
        const e = failingMap.get(r.tool_name) || { count: 0, last: '' };
        e.count++;
        if (!e.last && r.error_message) e.last = r.error_message;
        failingMap.set(r.tool_name, e);
      }
    }
    const top_failing = Array.from(failingMap.entries())
      .map(([tool, v]) => ({ tool, errors: v.count, lastMsg: v.last }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 3);

    const tenants = new Set(items.map((r) => r.tenant_id).filter(Boolean));

    return {
      agent,
      total,
      success,
      success_rate: total > 0 ? Math.round((100 * success) / total) : 0,
      avg_duration_ms: avg,
      top_failing,
      tenants_count: tenants.size,
    };
  });
}

export default async function AdminAgentsPage() {
  const stats = await loadAgentStats();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Plataforma</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">Agent performance</h1>
        <p className="mt-1.5 text-sm text-white/50">Últimos 7 días — tool_call_logs agregados.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats.map((s, idx) => {
          const rateColor = s.success_rate > 90 ? 'text-emerald-300' : s.success_rate > 70 ? 'text-amber-300' : 'text-red-300';
          return (
            <div
              key={s.agent}
              className="stagger-item glass-card p-5"
              style={{ animationDelay: `${60 + idx * 40}ms` }}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-white">{s.agent}</h3>
                <span className="text-[11px] uppercase tracking-wider text-white/40">
                  {s.tenants_count} tenant{s.tenants_count === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/45">Éxito</p>
                  <p className={`mt-1 text-xl font-semibold tabular-nums ${rateColor}`}>
                    {s.success_rate}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/45">Avg ms</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-white/85">
                    {s.avg_duration_ms || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/45">Total</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-white/85">
                    {s.total}
                  </p>
                </div>
              </div>

              {s.top_failing.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 mb-2">
                    Top failing tools
                  </p>
                  <ul className="space-y-1.5">
                    {s.top_failing.map((t) => (
                      <li key={t.tool} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-white/70 font-mono truncate">{t.tool}</span>
                        <span className="text-red-300 tabular-nums shrink-0">
                          {t.errors} error{t.errors === 1 ? '' : 'es'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
