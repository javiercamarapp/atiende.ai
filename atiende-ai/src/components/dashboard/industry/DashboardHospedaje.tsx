'use client';
import { Card } from '@/components/ui/card';
import { Clock, Calendar, Zap, MessageSquare } from 'lucide-react';
import Link from 'next/link';

interface IndustryDashProps {
  tenant: Record<string, unknown>;
  roi: { messagesSaved: number; hoursSaved: number; totalSavingsMXN: number; roiPercent: number; monthlyCostMXN: number };
  todayData: Record<string, number> | null;
  monthData: Record<string, number>[];
  appointments: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
}

export function DashboardHospedaje({ roi, todayData, monthData, appointments, conversations }: IndustryDashProps) {
  const tApts = monthData.reduce((s,d)=>s+(d.appointments_booked||0),0);
  const tMsgs = monthData.reduce((s,d)=>s+(d.messages_inbound||0),0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 border-zinc-200/60 shadow-sm"><p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">Reservaciones hoy</p><p className="text-4xl font-bold text-zinc-900 tabular-nums">{appointments.length}</p><p className="text-xs text-zinc-400 mt-1">check-ins programados</p></Card>
        <Card className="p-6 border-zinc-200/60 shadow-sm"><p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">Mensajes atendidos</p><p className="text-4xl font-bold text-zinc-900 tabular-nums">{roi.messagesSaved.toLocaleString()}</p><p className="text-xs text-zinc-400 mt-1">este mes por tu agente</p></Card>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{l:'Mensajes hoy',v:todayData?.messages_inbound||0,I:MessageSquare},{l:'Reservaciones hoy',v:todayData?.appointments_booked||0,I:Calendar},{l:'Reservaciones mes',v:tApts,I:Calendar},{l:'Msgs ahorrados',v:tMsgs,I:Zap}].map(k=>(
          <Card key={k.l} className="p-4 border-zinc-200/60 shadow-sm"><div className="flex items-center gap-2 mb-2"><k.I className="w-4 h-4 text-zinc-400"/><span className="text-[11px] text-zinc-400 uppercase tracking-wider">{k.l}</span></div><p className="text-2xl font-bold text-zinc-900 tabular-nums">{k.v}</p></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-zinc-200/60 shadow-sm p-4"><h3 className="text-sm font-medium text-zinc-900 flex items-center gap-2 mb-3"><Calendar className="w-4 h-4 text-zinc-400"/>Proximas reservaciones</h3>
          {appointments.slice(0,6).map((a:Record<string,unknown>)=>(<div key={a.id as string} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-50 transition-colors"><Clock className="w-3 h-3 text-zinc-300 shrink-0"/><div><p className="text-sm text-zinc-900">{(a.customer_name as string)||(a.customer_phone as string)}</p><p className="text-xs text-zinc-400">{new Date(a.datetime as string).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</p></div></div>))}
          {appointments.length===0&&<p className="text-xs text-zinc-400 text-center py-4">Sin reservaciones hoy</p>}
        </Card>
        <Card className="border-zinc-200/60 shadow-sm p-4"><h3 className="text-sm font-medium text-zinc-900 flex items-center gap-2 mb-3"><MessageSquare className="w-4 h-4 text-zinc-400"/>Conversaciones recientes</h3>
          {conversations.slice(0,5).map((c:Record<string,unknown>)=>(<Link key={c.id as string} href={`/conversations/${c.id}`} className="block p-2 rounded-lg hover:bg-zinc-50 transition-colors"><p className="text-sm font-medium text-zinc-900 truncate">{(c.customer_name as string)||(c.customer_phone as string)}</p><p className="text-xs text-zinc-400 truncate">{((c.messages as Record<string,unknown>[])?.[((c.messages as Record<string,unknown>[])?.length??1)-1]?.content as string)?.substring(0,50)||'Sin msgs'}</p></Link>))}
          {conversations.length===0&&<p className="text-xs text-zinc-400 text-center py-4">Sin conversaciones aun</p>}
        </Card>
      </div>
    </div>
  );
}
