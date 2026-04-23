import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function getAdminStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalTenants },
    { count: activeTenants },
    { count: trialTenants },
    { count: cancelledTenants },
    { count: monthMessages },
    { data: tenants },
    { data: topTenants },
    { data: recentTenants },
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('plan', 'free_trial'),
    supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
    supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabaseAdmin.from('tenants').select('id, plan').eq('status', 'active'),
    supabaseAdmin.from('daily_analytics')
      .select('tenant_id, messages_inbound, messages_outbound, tenants!inner(name)')
      .gte('date', thirtyDaysAgo)
      .order('messages_inbound', { ascending: false })
      .limit(100),
    supabaseAdmin.from('tenants')
      .select('id, name, business_type, plan, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Calculate MRR from plan prices
  const planPrices: Record<string, number> = {
    starter: 499, professional: 999, business: 1999, enterprise: 4999, trial: 0, free: 0,
  };
  const mrr = (tenants || []).reduce((sum, t) => sum + (planPrices[t.plan as string] || 0), 0);

  // Aggregate top tenants by total messages
  const tenantMessageMap = new Map<string, { name: string; total: number }>();
  for (const row of topTenants || []) {
    const tid = row.tenant_id as string;
    const existing = tenantMessageMap.get(tid);
    const msgs = ((row.messages_inbound as number) || 0) + ((row.messages_outbound as number) || 0);
    const tenantRec = row.tenants as unknown as { name: string } | null;
    if (existing) {
      existing.total += msgs;
    } else {
      tenantMessageMap.set(tid, { name: tenantRec?.name || tid, total: msgs });
    }
  }
  const top10 = Array.from(tenantMessageMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return {
    totalTenants: totalTenants || 0,
    activeTenants: activeTenants || 0,
    trialTenants: trialTenants || 0,
    cancelledTenants: cancelledTenants || 0,
    monthMessages: monthMessages || 0,
    mrr,
    top10,
    recentTenants: recentTenants || [],
  };
}

export default async function AdminDashboard() {
  const stats = await getAdminStats();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-900">Dashboard</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Tenants" value={stats.totalTenants} />
        <Card label="Active" value={stats.activeTenants} color="emerald" />
        <Card label="Trial" value={stats.trialTenants} color="amber" />
        <Card label="Cancelled" value={stats.cancelledTenants} color="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card label="Messages (this month)" value={stats.monthMessages.toLocaleString()} />
        <Card label="MRR" value={`$${stats.mrr.toLocaleString()} MXN`} color="emerald" />
        <Card label="LLM Cost (est)" value="--" />
      </div>

      {/* Top 10 Tenants */}
      <div className="bg-white rounded-lg border border-zinc-200 p-6">
        <h3 className="font-semibold text-zinc-900 mb-4">Top 10 Tenants by Messages (30d)</h3>
        <div className="space-y-2">
          {stats.top10.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
              <span className="text-sm text-zinc-700">{i + 1}. {t.name}</span>
              <span className="text-sm font-mono font-semibold text-zinc-900">{t.total.toLocaleString()}</span>
            </div>
          ))}
          {stats.top10.length === 0 && <p className="text-sm text-zinc-400">No data yet</p>}
        </div>
      </div>

      {/* Recent Tenants */}
      <div className="bg-white rounded-lg border border-zinc-200 p-6">
        <h3 className="font-semibold text-zinc-900 mb-4">Recent Tenants</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Plan</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentTenants.map((t) => (
              <tr key={t.id} className="border-b border-zinc-50">
                <td className="py-2 font-medium text-zinc-900">{t.name}</td>
                <td className="py-2 text-zinc-600">{t.business_type}</td>
                <td className="py-2"><PlanBadge plan={t.plan as string} /></td>
                <td className="py-2"><StatusBadge status={t.status as string} /></td>
                <td className="py-2 text-zinc-500">{new Date(t.created_at as string).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string | number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="bg-white rounded-lg border border-zinc-200 p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ? colorMap[color] : 'text-zinc-900'}`}>{value}</p>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    trial: 'bg-amber-100 text-amber-700',
    starter: 'bg-blue-100 text-blue-700',
    professional: 'bg-purple-100 text-purple-700',
    business: 'bg-emerald-100 text-emerald-700',
    enterprise: 'bg-zinc-800 text-white',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[plan] || 'bg-zinc-100 text-zinc-600'}`}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    paused: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-zinc-100 text-zinc-600'}`}>
      {status}
    </span>
  );
}
