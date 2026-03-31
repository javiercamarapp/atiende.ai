import { createServerSupabase } from '@/lib/supabase/server';
import { LeadsPipeline } from '@/components/dashboard/leads-pipeline';
import { Users } from 'lucide-react';

export default async function LeadsPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:leads}=await supabase.from('leads').select('*').eq('tenant_id',tenant!.id).order('score',{ascending:false}).limit(100);
  return(
    <div>
      <h1 className="text-xl font-bold mb-4">Pipeline de Leads</h1>
      {(!leads || leads.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900">Sin leads todavia</h3>
          <p className="text-sm text-zinc-500 mt-1">Los leads capturados por el bot apareceran aqui</p>
        </div>
      ) : (
        <LeadsPipeline leads={leads} />
      )}
    </div>
  );
}
