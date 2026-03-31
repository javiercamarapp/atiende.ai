import { createServerSupabase } from '@/lib/supabase/server';
import { BillingManager } from '@/components/dashboard/billing-manager';
export default async function BillingPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('*').eq('user_id',user!.id).single();
  return(<div><h1 className="text-xl font-bold mb-4">Facturación y Plan</h1><BillingManager tenant={tenant}/></div>);
}
