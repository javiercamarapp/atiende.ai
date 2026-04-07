import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { DashCharts } from '@/components/dashboard/charts';
import { LLMCosts } from '@/components/dashboard/llm-costs';
import { calculateROI } from '@/lib/analytics/roi';

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user!.id).single();
  const ago90 = new Date(new Date().getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: analytics } = await supabase.from('daily_analytics').select('*').eq('tenant_id', tenant!.id).gte('date', ago90).order('date');
  const roi = calculateROI(tenant!, analytics || []);
  const totalMsgs = (analytics || []).reduce((s, d) => s + (d.messages_inbound || 0), 0);
  const totalCost = (analytics || []).reduce((s, d) => s + (d.llm_cost_usd || 0), 0);

  // LLM Cost data: cost distribution by model
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthStart = startOfMonth.toISOString();

  const { data: modelRows } = await supabase
    .from('messages')
    .select('model_used, cost_usd')
    .eq('tenant_id', tenant!.id)
    .gte('created_at', monthStart)
    .not('model_used', 'is', null);

  // Aggregate model costs in JS (Supabase JS client doesn't support GROUP BY)
  const modelMap = new Map<string, { count: number; total_cost: number }>();
  for (const row of modelRows || []) {
    if (!row.model_used) continue;
    const entry = modelMap.get(row.model_used) || { count: 0, total_cost: 0 };
    entry.count += 1;
    entry.total_cost += Number(row.cost_usd) || 0;
    modelMap.set(row.model_used, entry);
  }
  const modelCosts = Array.from(modelMap.entries()).map(([model_used, v]) => ({
    model_used,
    count: v.count,
    total_cost: v.total_cost,
  }));

  const totalMonthCost = modelCosts.reduce((s, m) => s + m.total_cost, 0);

  // Daily cost trend (last 30 days) from daily_analytics
  const ago30Date = new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dailyCosts = (analytics || [])
    .filter((d) => d.date >= ago30Date)
    .map((d) => ({
      date: d.date as string,
      cost: Number(d.llm_cost_usd) || 0,
    }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Analytics (90 dias)</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{totalMsgs.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Mensajes totales</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{roi.hoursSaved}h</p>
          <p className="text-xs text-gray-500">Horas ahorradas</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">${roi.totalSavingsMXN.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Ahorro MXN</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">${totalCost.toFixed(2)}</p>
          <p className="text-xs text-gray-500">Costo LLM USD</p>
        </Card>
      </div>
      <DashCharts tenant={tenant} data={analytics || []} />

      <div className="pt-4 border-t">
        <h2 className="text-lg font-bold mb-4">Costos de AI</h2>
        <LLMCosts
          modelCosts={modelCosts}
          dailyCosts={dailyCosts}
          totalMonthCost={totalMonthCost}
        />
      </div>
    </div>
  );
}
