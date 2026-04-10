'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, User } from 'lucide-react';
const COLORS:Record<string,string>={scheduled:'bg-zinc-100 text-zinc-700',confirmed:'bg-zinc-900 text-white',completed:'bg-zinc-100 text-zinc-400',no_show:'bg-red-50 text-red-700',cancelled:'bg-red-50 text-red-700 line-through'};
export function AppointmentsList({appointments}:{appointments:any[]}) {
  return(<div className="space-y-2">
    {appointments.length===0&&<p className="text-zinc-400 text-center py-8">Sin citas</p>}
    {appointments.map(a=>(<Card key={a.id} className="p-4"><div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="text-center bg-zinc-100 rounded-lg p-2 w-16"><p className="text-xs text-zinc-500 font-medium">{new Date(a.datetime).toLocaleDateString('es-MX',{day:'numeric',month:'short'})}</p><p className="text-lg font-bold text-zinc-900">{new Date(a.datetime).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</p></div>
        <div><p className="font-medium flex items-center gap-2"><User className="w-3 h-3"/>{a.customer_name||a.customer_phone}</p><p className="text-sm text-zinc-500">{a.services?.name||'Servicio'}{a.staff?.name&&` · ${a.staff.name}`}</p><p className="text-xs text-zinc-400"><Clock className="w-3 h-3 inline mr-1"/>{a.duration_minutes}min</p></div>
      </div><Badge className={COLORS[a.status]||''}>{a.status}</Badge></div></Card>))}
  </div>);
}
