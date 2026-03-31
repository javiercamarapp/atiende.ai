'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { User, Phone } from 'lucide-react';
import Link from 'next/link';

export function ConversationList({ conversations }:{ conversations:any[] }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter==='all'?conversations:conversations.filter(c=>c.status===filter);
  return (
    <div>
      <div className="flex gap-2 mb-4">
        {['all','active','human_handoff','resolved'].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className={`px-3 py-1 rounded-full text-sm ${filter===f?'bg-blue-100 text-blue-700 font-medium':'bg-gray-100 text-gray-600'}`}>
            {f==='all'?'Todas':f==='active'?'🤖 Bot':f==='human_handoff'?'👤 Humano':'✅ Resueltas'}
          </button>))}
      </div>
      <div className="space-y-2">
        {filtered.map(c=>{const last=c.messages?.[c.messages.length-1];return(
          <Link key={c.id} href={`/conversations/${c.id}`}><Card className="p-3 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">{c.channel==='voice'?<Phone className="w-4 h-4"/>:<User className="w-4 h-4"/>}</div>
                <div><p className="font-medium text-sm">{c.customer_name||c.customer_phone}</p><p className="text-xs text-gray-500 truncate max-w-xs">{last?.content?.substring(0,60)||'Sin mensajes'}</p></div>
              </div>
              <Badge variant={c.status==='human_handoff'?'destructive':'default'}>{c.status==='human_handoff'?'👤':'🤖'}</Badge>
            </div></Card></Link>);})}
      </div>
    </div>
  );
}
