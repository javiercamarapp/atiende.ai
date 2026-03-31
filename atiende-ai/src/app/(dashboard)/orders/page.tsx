import { createServerSupabase } from '@/lib/supabase/server';
import { OrdersList } from '@/components/dashboard/orders-list';
import { ShoppingBag } from 'lucide-react';

export default async function OrdersPage() {
  const supabase=await createServerSupabase();const{data:{user}}=await supabase.auth.getUser();
  const{data:tenant}=await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const{data:orders}=await supabase.from('orders').select('*').eq('tenant_id',tenant!.id).order('created_at',{ascending:false}).limit(50);
  return(
    <div>
      <h1 className="text-xl font-bold mb-4">Pedidos</h1>
      {(!orders || orders.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShoppingBag className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900">Sin pedidos todavia</h3>
          <p className="text-sm text-zinc-500 mt-1">Los pedidos realizados por el bot apareceran aqui</p>
        </div>
      ) : (
        <OrdersList orders={orders} />
      )}
    </div>
  );
}
