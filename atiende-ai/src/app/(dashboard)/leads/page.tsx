import { createServerSupabase } from '@/lib/supabase/server';
import { LeadsPipeline } from '@/components/dashboard/leads-pipeline';
export default async function LeadsPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:leads}=await supabase.from('leads').select('*').eq('tenant_id',tenant!.id).order('score',{ascending:false}).limit(100);
  return(<div><h1 className="text-xl font-bold mb-4">Pipeline de Leads</h1><LeadsPipeline leads={leads||[]}/></div>);
}
