'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
const PLANS=[{key:'basic',name:'Básico',price:499,msgs:'500 msgs/mes'},{key:'pro',name:'Pro',price:999,msgs:'2,000 msgs/mes'},{key:'premium',name:'Premium',price:1499,msgs:'Ilimitado + Voz'}];
export function BillingManager({tenant}:{tenant:any}) {
  const[loading,setLoading]=useState('');
  const upgrade=async(plan:string,method:string)=>{setLoading(plan+method);
    const r=await fetch('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:tenant.id,email:tenant.email,plan,method,name:tenant.name})});
    const d=await r.json();if(method==='stripe'&&d.url)window.location.href=d.url;if(method==='oxxo'&&d.oxxoReference)alert('Referencia OXXO: '+d.oxxoReference);if(method==='spei'&&d.clabe)alert('CLABE: '+d.clabe);setLoading('');};
  return(<div className="space-y-4"><Card><CardContent className="pt-6"><Badge className="text-lg px-3 py-1">{tenant.plan}</Badge>{tenant.trial_ends_at&&<p className="text-sm text-gray-500 mt-2">Prueba hasta: {new Date(tenant.trial_ends_at).toLocaleDateString('es-MX')}</p>}</CardContent></Card>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{PLANS.map(p=>(<Card key={p.key} className={tenant.plan===p.key?'border-blue-500 bg-blue-50':''}><CardContent className="pt-6"><h3 className="font-bold text-lg">{p.name}</h3><p className="text-2xl font-bold mt-1">${p.price}<span className="text-sm text-gray-500"> MXN/mes</span></p><p className="text-xs text-gray-500 mt-1">{p.msgs}</p>
      {tenant.plan!==p.key&&<div className="mt-4 space-y-2"><Button className="w-full" size="sm" onClick={()=>upgrade(p.key,'stripe')} disabled={!!loading}>💳 Tarjeta</Button><Button className="w-full" size="sm" variant="outline" onClick={()=>upgrade(p.key,'oxxo')} disabled={!!loading}>🏪 OXXO</Button><Button className="w-full" size="sm" variant="outline" onClick={()=>upgrade(p.key,'spei')} disabled={!!loading}>🏦 SPEI</Button></div>}</CardContent></Card>))}</div></div>);
}
