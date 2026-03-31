import { createServerSupabase } from '@/lib/supabase/server';
import { AppointmentsList } from '@/components/dashboard/appointments-list';
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
          <Calendar className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900">Sin citas todavia</h3>
          <p className="text-sm text-zinc-500 mt-1">Las citas agendadas por el bot apareceran aqui</p>
        </div>
      ) : (
        <AppointmentsList appointments={apts} />
      )}
    </div>
  );
}
