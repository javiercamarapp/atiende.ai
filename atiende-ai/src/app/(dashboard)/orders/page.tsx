import { createServerSupabase } from '@/lib/supabase/server';
import { OrdersList } from '@/components/dashboard/orders-list';
export default async function OrdersPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:orders}=await supabase.from('orders').select('*').eq('tenant_id',tenant!.id).order('created_at',{ascending:false}).limit(50);
  return(<div><h1 className="text-xl font-bold mb-4">Pedidos</h1><OrdersList orders={orders||[]}/></div>);
}
