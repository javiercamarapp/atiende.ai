import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function getAnalytics() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [
    { data: dailyMessages },
    { data: tenants },
    { count: totalTenants },
    { count: cancelledLast30 },
    { data: llmByDay },
  ] = await Promise.all([
    // Messages per day (last 30 days)
    supabaseAdmin
      .from('daily_analytics')
      .select('date, messages_inbound, messages_outbound')
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: true }),
    // All tenants for revenue and industry breakdown
    supabaseAdmin
      .from('tenants')
      .select('id, plan, status, business_type, created_at'),
    // Total tenants 90 days ago (for churn calc)
    supabaseAdmin
      .from('tenants')
      .select('*', { count: 'exact', head: true })
      .lte('created_at', ninetyDaysAgo),
    // Cancelled in last 30 days
    supabaseAdmin
      .from('tenants')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('updated_at', thirtyDaysAgo),
    // LLM cost per day
    supabaseAdmin
      .from('daily_analytics')
      .select('date, llm_cost, llm_model')
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: true }),
  ]);

  // Aggregate messages per day
  const dailyMap = new Map<string, { inbound: number; outbound: number }>();
  for (const row of dailyMessages || []) {
    const date = row.date as string;
    const existing = dailyMap.get(date) || { inbound: 0, outbound: 0 };
    existing.inbound += (row.messages_inbound as number) || 0;
    existing.outbound += (row.messages_outbound as number) || 0;
    dailyMap.set(date, existing);
  }
  const messagesPerDay = Array.from(dailyMap.entries())
    .map(([date, vals]) => ({ date, ...vals, total: vals.inbound + vals.outbound }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Plan prices for revenue
  const planPrices: Record<string, number> = {
    starter: 499, professional: 999, business: 1999, enterprise: 4999, trial: 0, free: 0,
  };
  const activeTenants = (tenants || []).filter(t => t.status === 'active');
  const mrr = activeTenants.reduce((sum, t) => sum + (planPrices[t.plan as string] || 0), 0);

  // Churn rate
  const churnRate = (totalTenants || 0) > 0
    ? ((cancelledLast30 || 0) / (totalTenants || 1) * 100).toFixed(1)
    : '0.0';

  // Industry breakdown
  const industryMap = new Map<string, number>();
  for (const t of tenants || []) {
    const type = (t.business_type as string) || 'unknown';
    industryMap.set(type, (industryMap.get(type) || 0) + 1);
  }
  const topIndustries = Array.from(industryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // LLM cost per model
  const modelCostMap = new Map<string, number>();
  let totalLlmCost = 0;
  for (const row of llmByDay || []) {
    const model = (row.llm_model as string) || 'unknown';
    const cost = Number(row.llm_cost) || 0;
    modelCostMap.set(model, (modelCostMap.get(model) || 0) + cost);
    totalLlmCost += cost;
  }
  const costByModel = Array.from(modelCostMap.entries())
    .sort((a, b) => b[1] - a[1]);

  // Average messages per tenant
  const totalMessages30d = messagesPerDay.reduce((sum, d) => sum + d.total, 0);
  const avgMessagesPerTenant = activeTenants.length > 0
    ? Math.round(totalMessages30d / activeTenants.length)
    : 0;

  return {
    messagesPerDay,
    mrr,
    churnRate,
    topIndustries,
    costByModel,
    totalLlmCost,
    avgMessagesPerTenant,
    totalMessages30d,
    activeTenantCount: activeTenants.length,
  };
}

export default async function AnalyticsPage() {
  const stats = await getAnalytics();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-900">Platform Analytics</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="MRR" value={`$${stats.mrr.toLocaleString()} MXN`} color="emerald" />
        <Card label="Churn Rate (30d)" value={`${stats.churnRate}%`} color={Number(stats.churnRate) > 5 ? 'red' : 'emerald'} />
        <Card label="Avg Msgs/Tenant" value={stats.avgMessagesPerTenant.toLocaleString()} />
        <Card label="Total LLM Cost (30d)" value={`$${stats.totalLlmCost.toFixed(2)} USD`} color="amber" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card label="Total Messages (30d)" value={stats.totalMessages30d.toLocaleString()} />
        <Card label="Active Tenants" value={stats.activeTenantCount.toString()} color="emerald" />
        <Card label="Gross Margin" value={
          stats.mrr > 0
            ? `${((1 - (stats.totalLlmCost * 20) / stats.mrr) * 100).toFixed(0)}%`
            : '--'
        } color="emerald" />
      </div>

      {/* Messages Per Day */}
      <div className="bg-white rounded-lg border border-zinc-200 p-6">
        <h3 className="font-semibold text-zinc-900 mb-4">Messages Per Day (last 30 days)</h3>
        <div className="space-y-1">
          {stats.messagesPerDay.map((d) => {
            const maxVal = Math.max(...stats.messagesPerDay.map(x => x.total), 1);
            const widthPct = Math.max((d.total / maxVal) * 100, 1);
            return (
              <div key={d.date} className="flex items-center gap-3 text-xs">
                <span className="text-zinc-500 w-20 shrink-0">{d.date.slice(5)}</span>
                <div className="flex-1 bg-zinc-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="text-zinc-700 font-mono w-16 text-right">{d.total.toLocaleString()}</span>
              </div>
            );
          })}
          {stats.messagesPerDay.length === 0 && (
            <p className="text-sm text-zinc-400">No message data yet</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Industries */}
        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h3 className="font-semibold text-zinc-900 mb-4">Top Industries</h3>
          <div className="space-y-2">
            {stats.topIndustries.map(([industry, count]) => (
              <div key={industry} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                <span className="text-sm text-zinc-700">{industry.replace(/_/g, ' ')}</span>
                <span className="text-sm font-mono font-semibold text-zinc-900">{count}</span>
              </div>
            ))}
            {stats.topIndustries.length === 0 && <p className="text-sm text-zinc-400">No data</p>}
          </div>
        </div>

        {/* LLM Cost by Model */}
        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h3 className="font-semibold text-zinc-900 mb-4">LLM Cost by Model (30d)</h3>
          <div className="space-y-2">
            {stats.costByModel.map(([model, cost]) => (
              <div key={model} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                <span className="text-sm text-zinc-700 font-mono truncate max-w-[200px]">{model}</span>
                <span className="text-sm font-mono font-semibold text-amber-600">${cost.toFixed(4)}</span>
              </div>
            ))}
            {stats.costByModel.length === 0 && <p className="text-sm text-zinc-400">No LLM cost data</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="bg-white rounded-lg border border-zinc-200 p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ? colorMap[color] || '' : 'text-zinc-900'}`}>{value}</p>
    </div>
  );
}
