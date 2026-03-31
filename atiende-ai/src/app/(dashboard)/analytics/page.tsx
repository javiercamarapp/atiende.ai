import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { DashCharts } from '@/components/dashboard/charts';
import { calculateROI } from '@/lib/analytics/roi';

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user!.id).single();
  const ago90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: analytics } = await supabase.from('daily_analytics').select('*').eq('tenant_id', tenant!.id).gte('date', ago90).order('date');
  const roi = calculateROI(tenant!, analytics || []);
  const totalMsgs = (analytics || []).reduce((s, d) => s + (d.messages_inbound || 0), 0);
  const totalCost = (analytics || []).reduce((s, d) => s + (d.llm_cost_usd || 0), 0);

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
    </div>
  );
}
