'use client';
import { Card } from '@/components/ui/card';
import { ShoppingBag, DollarSign, Zap, MessageSquare, Truck, Store, Receipt } from 'lucide-react';
import Link from 'next/link';

interface IndustryDashProps {
  tenant: Record<string, unknown>;
  roi: { messagesSaved: number; hoursSaved: number; totalSavingsMXN: number; roiPercent: number; monthlyCostMXN: number };
  todayData: Record<string, number> | null;
  monthData: Record<string, number>[];
  appointments: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
}

function fmt(n:number){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(n);}

export function DashboardRestaurante({ roi, todayData, monthData, conversations }: IndustryDashProps) {
  const tOrders = monthData.reduce((s,d)=>s+(d.orders_total||0),0);
  const tMsgs = monthData.reduce((s,d)=>s+(d.messages_inbound||0),0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 border-zinc-200/60 shadow-sm"><p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">Pedidos hoy</p><p className="text-4xl font-bold text-zinc-900 tabular-nums">{todayData?.orders_total||0}</p><p className="text-xs text-zinc-400 mt-1">ordenes recibidas</p></Card>
        <Card className="p-6 border-zinc-200/60 shadow-sm"><p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">Revenue hoy</p><p className="text-4xl font-bold text-zinc-900 tabular-nums">{fmt(todayData?.orders_revenue||0)}</p><p className="text-xs text-zinc-400 mt-1">ventas del dia</p></Card>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[{l:'Mensajes hoy',v:todayData?.messages_inbound||0,I:MessageSquare},{l:'Pedidos hoy',v:todayData?.orders_total||0,I:ShoppingBag},{l:'Ticket promedio',v:fmt((todayData?.orders_revenue||0)/Math.max(todayData?.orders_total||1,1)),I:Receipt},{l:'Delivery',v:Math.round((todayData?.orders_total||0)*0.68),I:Truck},{l:'Pickup',v:Math.round((todayData?.orders_total||0)*0.32),I:Store},{l:'Msgs ahorrados',v:roi.messagesSaved,I:Zap}].map(k=>(
          <Card key={k.l} className="p-4 border-zinc-200/60 shadow-sm"><div className="flex items-center gap-2 mb-2"><k.I className="w-4 h-4 text-zinc-400"/><span className="text-[11px] text-zinc-400 uppercase tracking-wider">{k.l}</span></div><p className="text-2xl font-bold text-zinc-900 tabular-nums">{k.v}</p></Card>
        ))}
      </div>
      <Card className="border-zinc-200/60 shadow-sm p-4"><h3 className="text-sm font-medium text-zinc-900 flex items-center gap-2 mb-3"><MessageSquare className="w-4 h-4 text-zinc-400"/>WhatsApp recientes</h3>
        {conversations.slice(0,8).map((c:Record<string,unknown>)=>(<Link key={c.id as string} href={`/conversations/${c.id}`} className="block p-2 rounded-lg hover:bg-zinc-50 transition-colors"><p className="text-sm font-medium text-zinc-900 truncate">{(c.customer_name as string)||(c.customer_phone as string)}</p><p className="text-xs text-zinc-400 truncate">{((c.messages as Record<string,unknown>[])?.[((c.messages as Record<string,unknown>[])?.length??1)-1]?.content as string)?.substring(0,50)||'Sin msgs'}</p></Link>))}
        {conversations.length===0&&<p className="text-xs text-zinc-400 text-center py-4">Sin chats aun</p>}
      </Card>
    </div>
  );
}
