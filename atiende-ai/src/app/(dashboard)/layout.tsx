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
    <div className="dashboard-shell flex h-screen">
      <Sidebar tenant={tenant} modules={modules} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashHeader tenant={tenant} />
        {tenant.plan === 'free_trial' && tenant.trial_ends_at && (() => {
          const daysLeft = Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000);
          if (daysLeft <= 7 && daysLeft > 0) {
            return (
              <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between">
                <p className="text-sm text-amber-800">
                  Tu prueba gratis termina en <strong>{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</strong>.
                </p>
                <Link href="/settings/billing" className="text-sm font-medium text-amber-900 hover:text-amber-700 underline-offset-4 hover:underline transition">
                  Elegir plan
                </Link>
              </div>
            );
          }
          if (daysLeft <= 0) {
            return (
              <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center justify-between">
                <p className="text-sm text-red-700">
                  Tu prueba gratis ha terminado. Elige un plan para seguir usando el servicio.
                </p>
                <Link href="/settings/billing" className="text-sm font-medium text-red-800 hover:text-red-600 underline-offset-4 hover:underline transition">
                  Elegir plan
                </Link>
              </div>
            );
          }
          return null;
        })()}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="animate-element">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function getModules(type: string, hasVoice: boolean) {
  const base = ['dashboard','conversations','agents','knowledge','chat-data','marketing','analytics','settings'];
  // Verticales de salud + belleza + servicios recurrentes ven "contacts" (paciente/cliente health scores)
  const health = ['dental','medical','nutritionist','psychologist','dermatologist',
    'gynecologist','pediatrician','ophthalmologist','veterinary','optics',
    'salon','barbershop','spa','gym'];
  const withContacts = health.includes(type);
  const m: Record<string,string[]> = {
    dental:[...base,'appointments','contacts'], medical:[...base,'appointments','contacts'],
    nutritionist:[...base,'appointments','contacts'], psychologist:[...base,'appointments','contacts'],
    dermatologist:[...base,'appointments','contacts'], gynecologist:[...base,'appointments','contacts'],
    pediatrician:[...base,'appointments','contacts'], ophthalmologist:[...base,'appointments','contacts'],
    restaurant:[...base,'orders','appointments'], taqueria:[...base,'orders'],
    cafe:[...base,'orders'], hotel:[...base,'appointments'],
    real_estate:[...base,'leads','appointments'], salon:[...base,'appointments','contacts'],
    barbershop:[...base,'appointments','contacts'], spa:[...base,'appointments','contacts'],
    gym:[...base,'appointments','contacts'], veterinary:[...base,'appointments','contacts'],
    pharmacy:[...base], school:[...base,'leads'],
    insurance:[...base,'leads','appointments'], mechanic:[...base,'appointments'],
    accountant:[...base,'appointments','leads'], florist:[...base,'orders'],
    optics:[...base,'appointments','contacts'], other:[...base,'appointments'],
  };
  const mods = m[type] || [...base,'appointments'];
  if (hasVoice && !mods.includes('calls')) mods.push('calls');
  if (withContacts && !mods.includes('contacts')) mods.push('contacts');
  return mods;
}
