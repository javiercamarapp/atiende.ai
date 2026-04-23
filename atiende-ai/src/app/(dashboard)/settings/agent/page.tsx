'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
export default function AgentSettingsPage() {
  const[t,setT]=useState<{id:string;bot_name:string;welcome_message:string;chat_system_prompt:string;temperature:number;[k:string]:unknown}|null>(null);const[saving,setSaving]=useState(false);
  useEffect(()=>{(async()=>{const s=createClient();const{data:{user}}=await s.auth.getUser();const{data}=await s.from('tenants').select('*').eq('user_id',user!.id).single();setT(data);})();},[]);
  const save=async()=>{if(!t)return;setSaving(true);try{const s=createClient();const{error}=await s.from('tenants').update({bot_name:t.bot_name,welcome_message:t.welcome_message,chat_system_prompt:t.chat_system_prompt,temperature:t.temperature}).eq('id',t.id);if(error)throw error;toast.success('Guardado');}catch{toast.error('Error al guardar configuracion');}finally{setSaving(false);}};
  if(!t)return<div>Cargando...</div>;
  return(<div className="max-w-2xl space-y-6"><h1 className="text-xl font-bold">Configuración del Agente</h1>
    <div><Label>Nombre del bot</Label><Input value={t.bot_name||''} onChange={e=>setT({...t,bot_name:e.target.value})}/></div>
    <div><Label>Mensaje de bienvenida</Label><Textarea rows={3} value={t.welcome_message||''} onChange={e=>setT({...t,welcome_message:e.target.value})}/></div>
    <div><Label>System prompt</Label><Textarea rows={12} className="font-mono text-xs" value={t.chat_system_prompt||''} onChange={e=>setT({...t,chat_system_prompt:e.target.value})}/></div>
    <div><Label>Temperatura (0-1)</Label><Input type="number" min="0" max="1" step="0.1" value={t.temperature} onChange={e=>setT({...t,temperature:parseFloat(e.target.value)})}/></div>
    <Button onClick={save} disabled={saving}>{saving?'Guardando...':'Guardar'}</Button></div>);
}
