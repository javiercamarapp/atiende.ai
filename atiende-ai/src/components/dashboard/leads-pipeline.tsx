'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flame, ThermometerSun, Snowflake } from 'lucide-react';
const STAGES=[{key:'new',label:'Nuevos'},{key:'contacted',label:'Contactados'},{key:'qualified',label:'Calificados'},{key:'visit_scheduled',label:'Visita'},{key:'negotiating',label:'Negociando'},{key:'won',label:'Ganados'}];
export function LeadsPipeline({leads}:{leads:any[]}) {
  return(<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
    {STAGES.map(s=>{const sl=leads.filter(l=>l.status===s.key);return(
      <div key={s.key}><div className="flex items-center justify-between mb-2"><h3 className="text-xs font-bold text-gray-500 uppercase">{s.label}</h3><Badge variant="secondary">{sl.length}</Badge></div>
        <div className="space-y-2">{sl.map(l=>(<Card key={l.id} className="p-2">
          <div className="flex items-center gap-1 mb-1">{l.temperature==='hot'?<Flame className="w-3 h-3 text-red-500"/>:l.temperature==='warm'?<ThermometerSun className="w-3 h-3 text-orange-500"/>:<Snowflake className="w-3 h-3 text-blue-500"/>}<p className="text-xs font-medium truncate">{l.customer_name||l.customer_phone}</p></div>
          <p className="text-[10px] text-gray-400">Score: {l.score}/100</p></Card>))}</div></div>);})}
  </div>);
}
