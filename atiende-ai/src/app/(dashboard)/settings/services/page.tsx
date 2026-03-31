'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
export default function ServicesPage() {
  const[svcs,setSvcs]=useState<any[]>([]);const[tid,setTid]=useState('');
  useEffect(()=>{(async()=>{const s=createClient();const{data:{user}}=await s.auth.getUser();const{data:t}=await s.from('tenants').select('id').eq('user_id',user!.id).single();setTid(t!.id);const{data}=await s.from('services').select('*').eq('tenant_id',t!.id).order('name');setSvcs(data||[]);})();},[]);
  const add=()=>setSvcs([...svcs,{id:'new-'+Date.now(),name:'',price:0,duration_minutes:30,_new:true}]);
  const saveAll=async()=>{const s=createClient();for(const sv of svcs){if(sv._new)await s.from('services').insert({tenant_id:tid,name:sv.name,price:sv.price,duration_minutes:sv.duration_minutes});else await s.from('services').update({name:sv.name,price:sv.price,duration_minutes:sv.duration_minutes}).eq('id',sv.id);}
    await fetch('/api/knowledge/reingest-services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:tid})});toast.success('Servicios guardados y bot actualizado');};
  const rm=async(id:string)=>{if(!id.startsWith('new-')){const s=createClient();await s.from('services').delete().eq('id',id);}setSvcs(svcs.filter(s=>s.id!==id));};
  return(<div className="max-w-2xl"><div className="flex items-center justify-between mb-4"><h1 className="text-xl font-bold">Servicios y Precios</h1><Button onClick={add} size="sm"><Plus className="w-4 h-4 mr-1"/>Agregar</Button></div>
    <p className="text-sm text-gray-500 mb-4">Al guardar, tu bot se actualiza con los nuevos precios.</p>
    <div className="space-y-2">{svcs.map((s,i)=>(<Card key={s.id} className="p-3 flex items-center gap-3"><Input placeholder="Servicio" className="flex-1" value={s.name} onChange={e=>{const u=[...svcs];u[i].name=e.target.value;setSvcs(u)}}/><Input type="number" placeholder="$" className="w-24" value={s.price||''} onChange={e=>{const u=[...svcs];u[i].price=parseFloat(e.target.value);setSvcs(u)}}/><Input type="number" placeholder="min" className="w-20" value={s.duration_minutes} onChange={e=>{const u=[...svcs];u[i].duration_minutes=parseInt(e.target.value);setSvcs(u)}}/><Button variant="ghost" size="icon" onClick={()=>rm(s.id)}><Trash2 className="w-4 h-4 text-red-500"/></Button></Card>))}</div>
    <Button className="w-full mt-4" onClick={saveAll}><Save className="w-4 h-4 mr-1"/>Guardar Todo</Button></div>);
}
