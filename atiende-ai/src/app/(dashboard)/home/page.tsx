import { createServerSupabase } from '@/lib/supabase/server';
import { ROIWidget } from '@/components/dashboard/roi-widget';
import { KPICards } from '@/components/dashboard/kpi-cards';
import { DashCharts } from '@/components/dashboard/charts';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { calculateROI } from '@/lib/analytics/roi';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  const { data:tenant } = await supabase.from('tenants').select('*').eq('user_id',user!.id).single();
  if (!tenant) return <div>No tenant found</div>;
  const ago30 = new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0];
  const { data:analytics } = await supabase.from('daily_analytics').select('*').eq('tenant_id',tenant.id).gte('date',ago30).order('date');
  const today = new Date().toISOString().split('T')[0];
  const { data:todayData } = await supabase.from('daily_analytics').select('*').eq('tenant_id',tenant.id).eq('date',today).maybeSingle();
  const roi = calculateROI(tenant, analytics||[]);
  const { data:todayApts } = await supabase.from('appointments').select('*, staff(name), services(name)').eq('tenant_id',tenant.id).gte('datetime',`${today}T00:00:00`).lte('datetime',`${today}T23:59:59`).order('datetime');
  const { data:recentConvs } = await supabase.from('conversations').select('*, messages(content,direction,created_at)').eq('tenant_id',tenant.id).order('last_message_at',{ascending:false}).limit(5);
  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <header className="animate-element">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Panel
        </p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">
          {tenant.name}
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          Tu agente está escuchando en WhatsApp 24/7.
        </p>
      </header>

      <div className="animate-element animate-delay-200">
        <ROIWidget roi={roi} />
      </div>

      <KPICards tenant={tenant} today={todayData} monthData={analytics || []} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 stagger-item glass-card p-5">
          <DashCharts tenant={tenant} data={analytics || []} />
        </div>
        <div className="stagger-item glass-card p-5">
          <RecentActivity
            conversations={recentConvs || []}
            appointments={todayApts || []}
            tenant={tenant}
          />
        </div>
      </div>
    </div>
  );
}
