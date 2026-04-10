import { createServerSupabase } from '@/lib/supabase/server';
import { calculateROI } from '@/lib/analytics/roi';
import { getCluster } from '@/components/dashboard/industry/cluster-map';
import { DashboardDental } from '@/components/dashboard/industry/DashboardDental';
import { DashboardRestaurante } from '@/components/dashboard/industry/DashboardRestaurante';
import { redirect } from 'next/navigation';

const CLUSTER_COMPONENTS = {
  dental: DashboardDental,
  restaurante: DashboardRestaurante,
} as const;

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) redirect('/onboarding');

  const cluster = getCluster(tenant.business_type);
  if (!cluster) redirect('/onboarding'); // unsupported vertical → re-onboard

  const ago30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  const { data: analytics } = await supabase
    .from('daily_analytics')
    .select('*')
    .eq('tenant_id', tenant.id)
    .gte('date', ago30)
    .order('date');

  const today = new Date().toISOString().split('T')[0];
  const { data: todayData } = await supabase
    .from('daily_analytics')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('date', today)
    .maybeSingle();

  const roi = calculateROI(tenant, analytics || []);

  const { data: todayApts } = await supabase
    .from('appointments')
    .select('*, staff(name), services(name)')
    .eq('tenant_id', tenant.id)
    .gte('datetime', `${today}T00:00:00`)
    .lte('datetime', `${today}T23:59:59`)
    .order('datetime');

  const { data: recentConvs } = await supabase
    .from('conversations')
    .select('*, messages(content,direction,created_at)')
    .eq('tenant_id', tenant.id)
    .order('last_message_at', { ascending: false })
    .limit(8);

  const DashComponent = CLUSTER_COMPONENTS[cluster];

  return (
    <DashComponent
      tenant={tenant}
      roi={roi}
      todayData={todayData}
      monthData={analytics || []}
      appointments={todayApts || []}
      conversations={recentConvs || []}
    />
  );
}
