import { createServerSupabase } from '@/lib/supabase/server';
import { LeadsPipeline } from '@/components/dashboard/leads-pipeline';
import { Button } from '@/components/ui/button';
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 mb-4">
            <Users className="w-8 h-8 text-emerald-600" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-medium text-zinc-900">Aun no hay leads</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-sm">Los leads capturados por el bot apareceran aqui ordenados por score de interes.</p>
          <Button className="mt-6">Agregar lead</Button>
        </div>
      ) : (
        <LeadsPipeline leads={leads} />
      )}
    </div>
  );
}
