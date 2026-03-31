import { createServerSupabase } from '@/lib/supabase/server';
import { MarketplaceGrid } from '@/components/marketplace/grid';
export default async function AgentsPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id,plan').eq('user_id',user!.id).single();
  const{data:all}=await supabase.from('marketplace_agents').select('*').eq('is_active',true).order('category');
  const{data:active}=await supabase.from('tenant_agents').select('agent_id').eq('tenant_id',tenant!.id).eq('is_active',true);
  const ids=new Set((active||[]).map(a=>a.agent_id));
  return(<div><h1 className="text-xl font-bold mb-2">Agents Marketplace</h1><p className="text-gray-500 text-sm mb-6">Activa agentes complementarios con un click</p><MarketplaceGrid agents={all||[]} activeIds={ids} tenantId={tenant!.id}/></div>);
}
