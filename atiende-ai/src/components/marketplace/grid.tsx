'use client';
import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check } from 'lucide-react';
const CATS:Record<string,string>={cobranza:'💰 Cobranza',marketing:'📣 Marketing',analytics:'📊 Analytics',ops:'⚙️ Operaciones',ventas:'🎯 Ventas'};
export function MarketplaceGrid({agents,activeIds,tenantId}:{agents:any[];activeIds:Set<string>;tenantId:string}) {
  const[busy,setBusy]=useState<string|null>(null);const[active,setActive]=useState(activeIds);
  const toggle=async(id:string)=>{setBusy(id);const on=active.has(id);
    await fetch('/api/agents/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,agentId:id,action:on?'deactivate':'activate'})});
    const n=new Set(active);on?n.delete(id):n.add(id);setActive(n);setBusy(null);};
  const grouped=agents.reduce((a:any,ag:any)=>{const c=ag.category||'otros';if(!a[c])a[c]=[];a[c].push(ag);return a;},{});
  return(<div className="space-y-8">{Object.entries(grouped).map(([cat,ags]:[string,any])=>(
    <div key={cat}><h2 className="text-lg font-bold mb-3">{CATS[cat]||cat}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{ags.map((ag:any)=>{const on=active.has(ag.id);return(
        <Card key={ag.id} className={on?'border-green-300 bg-green-50/50':''}>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><span className="text-xl">{ag.icon}</span>{ag.name}{on&&<Badge variant="outline" className="text-green-600 border-green-300"><Check className="w-3 h-3 mr-1"/>Activo</Badge>}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-gray-600">{ag.description}</p><p className="text-sm font-bold text-blue-600 mt-2">${ag.price_mxn} MXN/mes</p></CardContent>
          <CardFooter><Button className="w-full" variant={on?'outline':'default'} size="sm" disabled={busy===ag.id} onClick={()=>toggle(ag.id)}>{busy===ag.id?<Loader2 className="w-4 h-4 animate-spin"/>:on?'Desactivar':'Activar'}</Button></CardFooter>
        </Card>);})}</div></div>))}</div>);
}
