import { createServerSupabase } from '@/lib/supabase/server';
import { AppointmentsList } from '@/components/dashboard/appointments-list';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

export default async function AppointmentsPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:apts}=await supabase.from('appointments').select('*, staff(name), services(name,price)').eq('tenant_id',tenant!.id).gte('datetime',new Date().toISOString().split('T')[0]+'T00:00:00').order('datetime').limit(50);
  return(
    <div>
      <h1 className="text-xl font-bold mb-4">Citas</h1>
      {(!apts || apts.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 mb-4">
            <Calendar className="w-8 h-8 text-emerald-600" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-medium text-zinc-900">No tienes citas todavia</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-sm">Las citas agendadas por el bot apareceran aqui. Crea tu primera cita para comenzar.</p>
          <Button className="mt-6">Crear primera cita</Button>
        </div>
      ) : (
        <AppointmentsList appointments={apts} />
      )}
    </div>
  );
}
