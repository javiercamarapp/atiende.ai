'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
const C:Record<string,string>={pending:'bg-zinc-100 text-zinc-700',confirmed:'bg-zinc-900 text-white',preparing:'bg-zinc-100 text-zinc-700',ready:'bg-zinc-900 text-white',delivered:'bg-zinc-100 text-zinc-400',cancelled:'bg-red-50 text-red-700'};
interface OrderItem { qty: number; name: string; price?: number; }
interface Order { id: string; customer_name?: string; customer_phone?: string; created_at: string; order_type: string; status: string; total?: number; items?: OrderItem[]; }
export function OrdersList({orders}:{orders:Order[]}) {
  return(<div className="space-y-2">{orders.map(o=>(<Card key={o.id} className="p-4">
    <div className="flex justify-between mb-2"><div><p className="font-medium">{o.customer_name||o.customer_phone}</p><p className="text-xs text-zinc-400">{new Date(o.created_at).toLocaleString('es-MX')} · {o.order_type}</p></div>
      <div className="text-right"><Badge className={C[o.status]||''}>{o.status}</Badge><p className="text-lg font-bold mt-1">${o.total?.toLocaleString()||'0'}</p></div></div>
    <div className="text-sm text-zinc-600">{(o.items)?.map((it:OrderItem,i:number)=><span key={i}>{it.qty}x {it.name}{i<(o.items?.length ?? 0)-1?', ':''}</span>)}</div>
  </Card>))}</div>);
}
