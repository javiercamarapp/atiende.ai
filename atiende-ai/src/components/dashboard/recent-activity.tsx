'use client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MessageSquare, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

export function RecentActivity({ conversations, appointments }:{
  conversations:Record<string,unknown>[]; appointments:Record<string,unknown>[];
}) {
  return (
    <div className="space-y-4">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4"/>Conversaciones recientes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {conversations.slice(0,5).map(c=>(
            <Link key={c.id} href={`/conversations/${c.id}`} className="block p-2 rounded hover:bg-gray-50">
              <p className="text-sm font-medium truncate">{c.customer_name||c.customer_phone}</p>
              <p className="text-xs text-gray-400 truncate">{c.messages?.[c.messages.length-1]?.content?.substring(0,50)||'Sin msgs'}</p>
            </Link>))}
          {conversations.length===0&&<p className="text-xs text-gray-400 text-center py-4">Sin conversaciones aún</p>}
        </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4"/>Próximas citas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {appointments.slice(0,5).map(a=>(
            <div key={a.id} className="flex items-center gap-2 p-2">
              <Clock className="w-3 h-3 text-gray-400"/>
              <div><p className="text-sm">{a.customer_name||a.customer_phone}</p>
                <p className="text-xs text-gray-400">{new Date(a.datetime).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}{a.services?.name&&` · ${a.services.name}`}</p></div>
            </div>))}
          {appointments.length===0&&<p className="text-xs text-gray-400 text-center py-4">Sin citas hoy</p>}
        </CardContent></Card>
    </div>
  );
}
