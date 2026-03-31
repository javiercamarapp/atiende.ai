'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, Hand, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export function ChatViewer({ conversation, messages, tenantId, phoneNumberId }:{
  conversation:any; messages:any[]; tenantId:string; phoneNumberId:string;
}) {
  const [status,setStatus]=useState(conversation.status);
  const [reply,setReply]=useState('');
  const [sending,setSending]=useState(false);
  const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages]);

  const takeOver=async()=>{
    const action=status==='human_handoff'?'release':'takeover';
    await fetch('/api/conversations/takeover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conversation.id,action})});
    setStatus(action==='takeover'?'human_handoff':'active');
  };
  const sendReply=async()=>{
    if(!reply.trim()||sending)return; setSending(true);
    await fetch('/api/conversations/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conversation.id,tenantId,phoneNumberId,to:conversation.customer_phone,text:reply})});
    setReply('');setSending(false);
  };
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-3"><Link href="/conversations"><ArrowLeft className="w-5 h-5 text-gray-500"/></Link><div><p className="font-medium">{conversation.customer_name||conversation.customer_phone}</p><p className="text-xs text-gray-400">{conversation.channel}</p></div></div>
        <div className="flex items-center gap-2">
          <Badge variant={status==='human_handoff'?'destructive':'default'}>{status==='human_handoff'?'👤 Humano':'🤖 Bot'}</Badge>
          <Button variant={status==='human_handoff'?'outline':'destructive'} size="sm" onClick={takeOver}><Hand className="w-4 h-4 mr-1"/>{status==='human_handoff'?'Devolver al bot':'Tomar control'}</Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map(m=>(
          <div key={m.id} className={`flex ${m.direction==='outbound'?'justify-end':'justify-start'}`}>
            <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${m.direction==='outbound'?m.sender_type==='human'?'bg-purple-100':'bg-blue-100':'bg-white border'}`}>
              {m.direction==='outbound'&&<p className="text-[10px] font-medium mb-0.5 opacity-60">{m.sender_type==='human'?'👤 Tú':'🤖 Bot'}</p>}
              <p className="text-sm">{m.content}</p>
              <p className="text-[10px] opacity-40 text-right mt-1">{new Date(m.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</p>
            </div></div>))}
        <div ref={bottom}/>
      </div>
      {status==='human_handoff'&&(<div className="p-3 border-t bg-white flex gap-2">
        <Input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendReply()} placeholder="Escribe..." className="flex-1"/>
        <Button onClick={sendReply} disabled={sending}><Send className="w-4 h-4"/></Button>
      </div>)}
    </div>
  );
}
