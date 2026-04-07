'use client';
import { Card } from '@/components/ui/card';
import { MessageSquare, Calendar, ShoppingBag, Users, Zap, TrendingDown } from 'lucide-react';

function getKPIs(type:string, today:any, month:any[]) {
  const tMsgs=month.reduce((s,d)=>s+(d.messages_inbound||0),0);
  const tAppts=month.reduce((s,d)=>s+(d.appointments_booked||0),0);
  const tNoShow=month.reduce((s,d)=>s+(d.appointments_no_show||0),0);
  const tOrders=month.reduce((s,d)=>s+(d.orders_total||0),0);
  const tLeads=month.reduce((s,d)=>s+(d.leads_new||0),0);
  const base=[
    {label:'Mensajes hoy',value:today?.messages_inbound||0,icon:MessageSquare,color:'text-emerald-600'},
    {label:'Msgs ahorrados',value:tMsgs,icon:Zap,color:'text-green-600'},
  ];
  const food=['restaurant','taqueria','cafe','florist'];
  const realty=['real_estate','insurance','school','accountant'];
  if(food.includes(type)) return [...base,
    {label:'Pedidos hoy',value:today?.orders_total||0,icon:ShoppingBag,color:'text-orange-600'},
    {label:'Revenue hoy',value:'$'+(today?.orders_revenue||0).toLocaleString(),icon:ShoppingBag,color:'text-green-600'},
    {label:'Pedidos mes',value:tOrders,icon:ShoppingBag,color:'text-purple-600'}];
  if(realty.includes(type)) return [...base,
    {label:'Leads nuevos',value:today?.leads_new||0,icon:Users,color:'text-emerald-600'},
    {label:'Leads mes',value:tLeads,icon:Users,color:'text-purple-600'}];
  return [...base,
    {label:'Citas hoy',value:today?.appointments_booked||0,icon:Calendar,color:'text-emerald-600'},
    {label:'No-shows mes',value:tNoShow,icon:TrendingDown,color:tNoShow>5?'text-red-600':'text-green-600'},
    {label:'Citas mes',value:tAppts,icon:Calendar,color:'text-purple-600'}];
}

export function KPICards({tenant,today,monthData}:{tenant:any;today:any;monthData:any[]}) {
  const kpis=getKPIs(tenant.business_type,today,monthData);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis.map(k=>{const Icon=k.icon;return(
        <Card key={k.label} className="p-4">
          <div className="flex items-center gap-2 mb-2"><Icon className={`w-4 h-4 ${k.color}`}/><span className="text-xs text-gray-500">{k.label}</span></div>
          <p className="text-2xl font-bold">{k.value}</p>
        </Card>);})}
    </div>
  );
}
