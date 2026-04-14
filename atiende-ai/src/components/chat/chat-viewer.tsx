'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Send, Hand, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { ConversationTags } from '@/components/chat/conversation-tags';
import { ConversationNotes, type ConversationNote } from '@/components/chat/conversation-notes';

interface ChatConversation {
  id: string;
  customer_name?: string;
  customer_phone: string;
  channel: string;
  status: string;
  tags?: string[];
  notes?: ConversationNote[];
}
interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'bot' | 'human' | 'system';
  content: string;
  created_at: string;
  wa_status?: string;
}
export function ChatViewer({ conversation, messages, tenantId, phoneNumberId }:{
  conversation: ChatConversation; messages: ChatMessage[]; tenantId: string; phoneNumberId: string;
}) {
  const [status, setStatus] = useState(conversation.status);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const initialTags: string[] = conversation.tags ?? [];
  const initialNotes: ConversationNote[] = Array.isArray(conversation.notes)
    ? conversation.notes
    : [];

  const takeOver = async () => {
    const action = status === 'human_handoff' ? 'release' : 'takeover';
    try {
      const res = await fetch('/api/conversations/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, action }),
      });
      if (!res.ok) throw new Error('Request failed');
      setStatus(action === 'takeover' ? 'human_handoff' : 'active');
    } catch {
      toast.error('Error al enviar mensaje');
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      // Server derives `phoneNumberId` and `to` from the authenticated
      // tenant + conversation record (security: prevents spoofing).
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          text: reply,
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      setReply('');
    } catch {
      toast.error('Error al enviar mensaje');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:flex-row">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b bg-background">
          <div className="flex items-center gap-3">
            <Link href="/conversations">
              <ArrowLeft className="w-5 h-5 text-gray-500 hover:text-foreground transition-colors" />
            </Link>
            <div>
              <p className="font-medium">
                {conversation.customer_name || conversation.customer_phone}
              </p>
              <p className="text-xs text-gray-400">{conversation.channel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status === 'human_handoff' ? 'destructive' : 'default'}>
              {status === 'human_handoff' ? '👤 Humano' : '🤖 Bot'}
            </Badge>
            <Button
              variant={status === 'human_handoff' ? 'outline' : 'destructive'}
              size="sm"
              onClick={takeOver}
            >
              <Hand className="w-4 h-4 mr-1" />
              {status === 'human_handoff' ? 'Devolver al bot' : 'Tomar control'}
            </Button>
          </div>
        </div>

        {/* Tags section */}
        <div className="px-4 py-2.5 border-b bg-muted/30">
          <ConversationTags
            conversationId={conversation.id}
            initialTags={initialTags}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                  m.direction === 'outbound'
                    ? m.sender_type === 'human'
                      ? 'bg-purple-100'
                      : 'bg-blue-100'
                    : 'bg-white border'
                }`}
              >
                {m.direction === 'outbound' && (
                  <p className="text-[10px] font-medium mb-0.5 opacity-60">
                    {m.sender_type === 'human' ? '👤 Tu' : '🤖 Bot'}
                  </p>
                )}
                <p className="text-sm">{m.content}</p>
                <p className="text-[10px] opacity-40 text-right mt-1 flex items-center justify-end gap-1">
                  {new Date(m.created_at).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {m.direction === 'outbound' && (
                    <span className={m.wa_status === 'read' ? 'text-blue-500' : ''}>
                      {m.wa_status === 'read' ? '✓✓' : m.wa_status === 'delivered' ? '✓✓' : '✓'}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {/* Reply input */}
        {status === 'human_handoff' && (
          <div className="p-3 border-t bg-white flex gap-2">
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendReply()}
              placeholder="Escribe..."
              className="flex-1"
            />
            <Button onClick={sendReply} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        )}
      </div>

      {/* Right sidebar: Notes panel */}
      <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l bg-background overflow-y-auto">
        <div className="p-4">
          <Separator className="mb-4 lg:hidden" />
          <ConversationNotes
            conversationId={conversation.id}
            initialNotes={initialNotes}
          />
        </div>
      </div>
    </div>
  );
}
