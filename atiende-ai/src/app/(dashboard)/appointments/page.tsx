import { createServerSupabase } from '@/lib/supabase/server';
import { AppointmentsList } from '@/components/dashboard/appointments-list';
export default async function AppointmentsPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:apts}=await supabase.from('appointments').select('*, staff(name), services(name,price)').eq('tenant_id',tenant!.id).gte('datetime',new Date().toISOString().split('T')[0]+'T00:00:00').order('datetime').limit(50);
  return(<div><h1 className="text-xl font-bold mb-4">Citas</h1><AppointmentsList appointments={apts||[]}/></div>);
}
