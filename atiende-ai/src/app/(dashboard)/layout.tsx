import { ReactNode } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/sidebar';
import { DashHeader } from '@/components/dashboard/header';

export default async function DashboardLayout({ children }:{children:ReactNode}) {
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data:tenant } = await supabase.from('tenants').select('*')
    .eq('user_id',user.id).single();
  if (!tenant) redirect('/onboarding/step-1');
  const modules = getModules(tenant.business_type, tenant.has_voice_agent);
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar tenant={tenant} modules={modules} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashHeader tenant={tenant} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function getModules(type: string, hasVoice: boolean) {
  const base = ['dashboard','conversations','agents','knowledge','analytics','settings'];
  const m: Record<string,string[]> = {
    dental:[...base,'appointments'], medical:[...base,'appointments'],
    nutritionist:[...base,'appointments'], psychologist:[...base,'appointments'],
    dermatologist:[...base,'appointments'], gynecologist:[...base,'appointments'],
    pediatrician:[...base,'appointments'], ophthalmologist:[...base,'appointments'],
    restaurant:[...base,'orders','appointments'], taqueria:[...base,'orders'],
    cafe:[...base,'orders'], hotel:[...base,'appointments'],
    real_estate:[...base,'leads','appointments'], salon:[...base,'appointments'],
    barbershop:[...base,'appointments'], spa:[...base,'appointments'],
    gym:[...base,'appointments'], veterinary:[...base,'appointments'],
    pharmacy:[...base], school:[...base,'leads'],
    insurance:[...base,'leads','appointments'], mechanic:[...base,'appointments'],
    accountant:[...base,'appointments','leads'], florist:[...base,'orders'],
    optics:[...base,'appointments'], other:[...base,'appointments'],
  };
  const mods = m[type] || [...base,'appointments'];
  if (hasVoice && !mods.includes('calls')) mods.push('calls');
  return mods;
}
