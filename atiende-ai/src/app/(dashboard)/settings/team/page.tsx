'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
export default function TeamPage() {
  const[staff,setStaff]=useState<any[]>([]);const[tid,setTid]=useState('');
  useEffect(()=>{(async()=>{const s=createClient();const{data:{user}}=await s.auth.getUser();const{data:t}=await s.from('tenants').select('id').eq('user_id',user!.id).single();setTid(t!.id);const{data}=await s.from('staff').select('*').eq('tenant_id',t!.id).order('name');setStaff(data||[]);})();},[]);
  const add=()=>setStaff([...staff,{id:'new-'+Date.now(),name:'',role:'',speciality:'',_new:true}]);
  const saveAll=async()=>{try{const s=createClient();for(const st of staff){if(st._new){const{error}=await s.from('staff').insert({tenant_id:tid,name:st.name,role:st.role,speciality:st.speciality});if(error)throw error;}else{const{error}=await s.from('staff').update({name:st.name,role:st.role,speciality:st.speciality}).eq('id',st.id);if(error)throw error;}}toast.success('Equipo guardado');}catch{toast.error('Error al guardar equipo');}};
  const rm=async(id:string)=>{if(!id.startsWith('new-')){const s=createClient();await s.from('staff').delete().eq('id',id);}setStaff(staff.filter(s=>s.id!==id));};
  return(<div className="max-w-2xl"><div className="flex items-center justify-between mb-4"><h1 className="text-xl font-bold">Equipo</h1><Button onClick={add} size="sm"><Plus className="w-4 h-4 mr-1"/>Agregar</Button></div>
    <div className="space-y-2">{staff.map((s,i)=>(<Card key={s.id} className="p-3 flex items-center gap-3"><Input placeholder="Nombre" className="flex-1" value={s.name} onChange={e=>{const u=[...staff];u[i].name=e.target.value;setStaff(u)}}/><Input placeholder="Rol" className="w-32" value={s.role||''} onChange={e=>{const u=[...staff];u[i].role=e.target.value;setStaff(u)}}/><Button variant="ghost" size="icon" onClick={()=>rm(s.id)}><Trash2 className="w-4 h-4 text-red-500"/></Button></Card>))}</div>
    <Button className="w-full mt-4" onClick={saveAll}><Save className="w-4 h-4 mr-1"/>Guardar</Button></div>);
}
