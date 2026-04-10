import { ReactNode } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Sidebar } from '@/components/dashboard/sidebar';
import { DashHeader } from '@/components/dashboard/header';

export default async function DashboardLayout({ children }:{children:ReactNode}) {
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data:tenant } = await supabase.from('tenants').select('*')
    .eq('user_id',user.id).single();
  if (!tenant) redirect('/onboarding');
  const modules = getModules(tenant.business_type, tenant.has_voice_agent);
  return (
    <div className="flex h-screen bg-zinc-50/50">
      <Sidebar tenant={tenant} modules={modules} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashHeader tenant={tenant} />
        {tenant.plan === 'free_trial' && tenant.trial_ends_at && (() => {
          const daysLeft = Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000);
          if (daysLeft <= 7 && daysLeft > 0) {
            return (
              <div className="bg-zinc-900 px-6 py-2.5 flex items-center justify-between">
                <p className="text-sm text-zinc-300">
                  Tu prueba gratis termina en <strong className="text-white">{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</strong>.
                </p>
                <Link href="/settings/billing" className="text-sm font-medium text-white hover:text-zinc-300 underline underline-offset-2">
                  Elegir plan
                </Link>
              </div>
            );
          }
          if (daysLeft <= 0) {
            return (
              <div className="bg-zinc-900 px-6 py-2.5 flex items-center justify-between">
                <p className="text-sm text-zinc-300">
                  Tu prueba gratis ha terminado. Elige un plan para seguir usando el servicio.
                </p>
                <Link href="/settings/billing" className="text-sm font-medium text-white hover:text-zinc-300 underline underline-offset-2">
                  Elegir plan
                </Link>
              </div>
            );
          }
          return null;
        })()}
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
