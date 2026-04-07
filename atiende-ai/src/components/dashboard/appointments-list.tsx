'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, User } from 'lucide-react';
const COLORS:Record<string,string>={scheduled:'bg-emerald-100 text-emerald-700',confirmed:'bg-green-100 text-green-700',completed:'bg-gray-100 text-gray-600',no_show:'bg-red-100 text-red-700',cancelled:'bg-gray-100 text-gray-400'};
export function AppointmentsList({appointments}:{appointments:any[]}) {
  return(<div className="space-y-2">
    {appointments.length===0&&<p className="text-gray-400 text-center py-8">Sin citas</p>}
    {appointments.map(a=>(<Card key={a.id} className="p-4"><div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="text-center bg-emerald-50 rounded-lg p-2 w-16"><p className="text-xs text-emerald-600 font-medium">{new Date(a.datetime).toLocaleDateString('es-MX',{day:'numeric',month:'short'})}</p><p className="text-lg font-bold text-emerald-800">{new Date(a.datetime).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</p></div>
        <div><p className="font-medium flex items-center gap-2"><User className="w-3 h-3"/>{a.customer_name||a.customer_phone}</p><p className="text-sm text-gray-500">{a.services?.name||'Servicio'}{a.staff?.name&&` · ${a.staff.name}`}</p><p className="text-xs text-gray-400"><Clock className="w-3 h-3 inline mr-1"/>{a.duration_minutes}min</p></div>
      </div><Badge className={COLORS[a.status]||''}>{a.status}</Badge></div></Card>))}
  </div>);
}
