'use client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function DashCharts({ tenant, data }:{ tenant:any; data:any[] }) {
  const cd = data.map(d=>({
    date:new Date(d.date).toLocaleDateString('es-MX',{day:'numeric',month:'short'}),
    mensajes:d.messages_inbound||0, citas:d.appointments_booked||0,
    pedidos:d.orders_total||0, revenue:d.orders_revenue||0, leads:d.leads_new||0,
  }));
  const isFood=['restaurant','taqueria','cafe'].includes(tenant.business_type);
  const isRealty=['real_estate','insurance'].includes(tenant.business_type);
  return (
    <div className="space-y-4">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Mensajes por día</CardTitle></CardHeader>
        <CardContent><ResponsiveContainer width="100%" height={200}>
          <AreaChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" fontSize={10}/><YAxis fontSize={10}/><Tooltip/><Area type="monotone" dataKey="mensajes" stroke="#3b82f6" fill="#dbeafe"/></AreaChart>
        </ResponsiveContainer></CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{isFood?'Revenue diario':isRealty?'Leads por día':'Citas por día'}</CardTitle></CardHeader>
        <CardContent><ResponsiveContainer width="100%" height={200}>
          <BarChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" fontSize={10}/><YAxis fontSize={10}/><Tooltip/>
            <Bar dataKey={isFood?'revenue':isRealty?'leads':'citas'} fill={isFood?'#10b981':isRealty?'#8b5cf6':'#6366f1'} radius={[4,4,0,0]}/></BarChart>
        </ResponsiveContainer></CardContent></Card>
    </div>
  );
}
