import { createServerSupabase } from '@/lib/supabase/server';
import { calculateROI } from '@/lib/analytics/roi';
import { getCluster } from '@/components/dashboard/industry/cluster-map';
import { DashboardSalud } from '@/components/dashboard/industry/DashboardSalud';
import { DashboardGastronomia } from '@/components/dashboard/industry/DashboardGastronomia';
import { DashboardHospedaje } from '@/components/dashboard/industry/DashboardHospedaje';
import { DashboardBelleza } from '@/components/dashboard/industry/DashboardBelleza';
import { DashboardRetail } from '@/components/dashboard/industry/DashboardRetail';
import { DashboardServicios } from '@/components/dashboard/industry/DashboardServicios';

const CLUSTER_COMPONENTS = {
  salud: DashboardSalud,
  gastronomia: DashboardGastronomia,
  hospedaje: DashboardHospedaje,
  belleza: DashboardBelleza,
  retail: DashboardRetail,
  servicios: DashboardServicios,
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
  if (!tenant) return <div>No tenant found</div>;

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
    .limit(5);

  // Dispatch to the correct industry dashboard based on business_type
  const cluster = getCluster(tenant.business_type);
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
