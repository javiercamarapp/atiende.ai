'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
const C:Record<string,string>={pending:'bg-yellow-100 text-yellow-700',confirmed:'bg-blue-100 text-blue-700',preparing:'bg-orange-100 text-orange-700',ready:'bg-green-100 text-green-700',delivered:'bg-gray-100 text-gray-600',cancelled:'bg-red-100 text-red-700'};
export function OrdersList({orders}:{orders:any[]}) {
  return(<div className="space-y-2">{orders.map(o=>(<Card key={o.id} className="p-4">
    <div className="flex justify-between mb-2"><div><p className="font-medium">{o.customer_name||o.customer_phone}</p><p className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString('es-MX')} · {o.order_type}</p></div>
      <div className="text-right"><Badge className={C[o.status]||''}>{o.status}</Badge><p className="text-lg font-bold mt-1">${o.total?.toLocaleString()||'0'}</p></div></div>
    <div className="text-sm text-gray-600">{(o.items as any[])?.map((it:any,i:number)=><span key={i}>{it.qty}x {it.name}{i<(o.items as any[]).length-1?', ':''}</span>)}</div>
  </Card>))}</div>);
}
