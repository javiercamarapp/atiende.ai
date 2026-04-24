'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Hand, ArrowLeft, Loader2, Paperclip, Smile, MoreHorizontal, Phone, Video, Bot, User, X } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { displayPatientName, patientInitials } from '@/lib/utils/patient-display';
import { cn } from '@/lib/utils';
import { ConversationTags } from '@/components/chat/conversation-tags';
import { ConversationNotes, type ConversationNote } from '@/components/chat/conversation-notes';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateSeparator(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shouldShowDate(msgs: ChatMessage[], idx: number): boolean {
  if (idx === 0) return true;
  const prev = new Date(msgs[idx - 1].created_at).toDateString();
  const curr = new Date(msgs[idx].created_at).toDateString();
  return prev !== curr;
}

export function ChatViewer({ conversation, messages, tenantId, phoneNumberId }: {
  conversation: ChatConversation; messages: ChatMessage[]; tenantId: string; phoneNumberId: string;
}) {
  const [status, setStatus] = useState(conversation.status);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const initialTags: string[] = conversation.tags ?? [];
  const initialNotes: ConversationNote[] = Array.isArray(conversation.notes)
    ? conversation.notes
    : [];

  // conversation.customer_name ya viene decrypted del server (conversations/[id]/page.tsx).
  // Si aún así es null/ciphertext/teléfono, displayPatientName cae a "Paciente …XXXX".
  const customerName = displayPatientName(conversation.customer_name ?? null, conversation.customer_phone);
  const customerInitials = patientInitials(conversation.customer_name ?? null, conversation.customer_phone);

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
      toast.error('Error al cambiar control');
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, text: reply }),
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
    <div className="flex h-[calc(100dvh-10rem)] md:h-[calc(100vh-8rem)] min-h-0">
      {/* ─── CHAT AREA ─── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 glass-card overflow-hidden">
        {/* Chat header */}
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 px-3 md:px-5 py-3 border-b border-zinc-100">
          <div className="flex items-center gap-2.5 md:gap-3 min-w-0 flex-1">
            <Link href="/conversations" className="lg:hidden text-zinc-400 hover:text-zinc-900 transition shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-zinc-100 flex items-center justify-center text-sm font-semibold text-zinc-600 shrink-0">
              {customerInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-900 truncate">{customerName}</p>
              <p className="text-[11px] text-zinc-400 truncate">
                {status === 'human_handoff' ? 'Control humano' : 'Agente IA activo'}
              </p>
            </div>
          </div>
          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            <button
              onClick={takeOver}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
                status === 'human_handoff'
                  ? 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                  : 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] hover:opacity-80',
              )}
            >
              {status === 'human_handoff' ? (
                <><Bot className="w-3.5 h-3.5" /> Devolver al bot</>
              ) : (
                <><Hand className="w-3.5 h-3.5" /> Tomar control</>
              )}
            </button>
            <button className="p-2 text-zinc-400 hover:text-zinc-600 transition"><Video className="w-4 h-4" /></button>
            <button className="p-2 text-zinc-400 hover:text-zinc-600 transition"><Phone className="w-4 h-4" /></button>
            <button onClick={() => setShowInfo(!showInfo)} className="hidden lg:inline-flex p-2 text-zinc-400 hover:text-zinc-600 transition"><MoreHorizontal className="w-4 h-4" /></button>
          </div>
          {/* Mobile: single action button */}
          <button
            onClick={() => setShowInfoSheet(true)}
            className="md:hidden w-9 h-9 rounded-full bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition flex items-center justify-center shrink-0"
            aria-label="Opciones"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Tags bar */}
        <div className="px-5 py-2 border-b border-zinc-100 bg-zinc-50/50">
          <ConversationTags conversationId={conversation.id} initialTags={initialTags} />
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 bg-[hsl(var(--background))]">
          {messages.map((m, idx) => (
            <div key={m.id}>
              {shouldShowDate(messages, idx) && (
                <div className="flex items-center justify-center py-3">
                  <span className="text-[10px] text-zinc-400 bg-white rounded-full px-3 py-1 shadow-sm">
                    {fmtDateSeparator(m.created_at)}
                  </span>
                </div>
              )}
              <div className={cn('flex', m.direction === 'outbound' ? 'justify-start' : 'justify-end')}>
                {m.direction === 'outbound' && (
                  <div className="w-7 h-7 rounded-full bg-zinc-200 flex items-center justify-center text-[10px] font-semibold text-zinc-600 shrink-0 mt-1 mr-2">
                    {m.sender_type === 'human' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                  </div>
                )}
                <div className={cn(
                  'max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm',
                  m.direction === 'inbound'
                    ? 'bg-[hsl(var(--brand-blue))] text-white rounded-br-md'
                    : 'bg-white text-zinc-900 border border-zinc-100 rounded-bl-md',
                )}>
                  <p className="text-sm leading-relaxed">{m.content}</p>
                  <div className={cn(
                    'flex items-center justify-end gap-1 mt-1 text-[10px]',
                    m.direction === 'inbound' ? 'text-white/60' : 'text-zinc-400',
                  )}>
                    <span className="tabular-nums">{fmtTime(m.created_at)}</span>
                    {m.direction === 'outbound' && (
                      <span className={m.wa_status === 'read' ? 'text-[hsl(var(--brand-blue))]' : ''}>
                        {m.wa_status === 'read' ? '✓✓' : m.wa_status === 'delivered' ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
                {m.direction === 'inbound' && (
                  <div className="w-7 h-7 rounded-full bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center text-[10px] font-semibold text-[hsl(var(--brand-blue))] shrink-0 mt-1 ml-2">
                    {customerInitials}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {/* Reply input */}
        <div className="px-5 py-3 border-t border-zinc-100 bg-white">
          {status !== 'human_handoff' && (
            <p className="text-[11px] text-zinc-400 mb-2 text-center">
              El bot está respondiendo. <button onClick={takeOver} className="text-[hsl(var(--brand-blue))] font-medium">Tomar control</button> para responder manualmente.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button className="hidden md:inline-flex p-2 text-zinc-400 hover:text-zinc-600 transition shrink-0">
              <Smile className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && status === 'human_handoff' && sendReply()}
              placeholder={status === 'human_handoff' ? 'Escribe un mensaje...' : 'Toma control para responder'}
              disabled={status !== 'human_handoff'}
              className="flex-1 min-w-0 text-sm bg-zinc-50 rounded-full px-4 py-2.5 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))] disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button className="hidden md:inline-flex p-2 text-zinc-400 hover:text-zinc-600 transition shrink-0">
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              onClick={sendReply}
              disabled={sending || status !== 'human_handoff' || !reply.trim()}
              className="w-10 h-10 rounded-full bg-[hsl(var(--brand-blue))] text-white flex items-center justify-center hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ─── ACCOUNT INFO SIDEBAR ─── */}
      {showInfo && (
        <div className="hidden lg:flex w-80 shrink-0 flex-col glass-card ml-4 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
            <h3 className="text-sm font-semibold text-zinc-900">Info de cuenta</h3>
            <button onClick={() => setShowInfo(false)} className="text-zinc-400 hover:text-zinc-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 text-center border-b border-zinc-100">
            <div className="w-20 h-20 mx-auto rounded-full bg-zinc-100 flex items-center justify-center text-2xl font-semibold text-zinc-600">
              {customerInitials}
            </div>
            <h4 className="mt-3 text-sm font-semibold text-zinc-900">{customerName}</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {status === 'human_handoff' ? 'Control humano' : 'Agente IA activo'}
            </p>
          </div>

          <div className="p-5 border-b border-zinc-100">
            <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Acerca de</h4>
            <p className="text-xs text-zinc-700 leading-relaxed">
              Paciente del {conversation.channel}. Teléfono: {conversation.customer_phone}
            </p>
          </div>

          <div className="p-5 border-b border-zinc-100">
            <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Canal</h4>
            <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[11px] font-medium capitalize">
              {conversation.channel}
            </span>
          </div>

          <div className="p-5 flex-1">
            <ConversationNotes conversationId={conversation.id} initialNotes={initialNotes} />
          </div>
        </div>
      )}

      {/* ─── MOBILE INFO SHEET ─── */}
      <Sheet open={showInfoSheet} onOpenChange={setShowInfoSheet}>
        <SheetContent
          side="right"
          className="lg:hidden p-0 flex flex-col bg-white border-0 rounded-l-[28px] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18)] w-[85%] max-w-[360px]"
        >
          <SheetHeader className="px-6 pt-7 pb-4">
            <SheetTitle className="text-[15px] font-semibold text-zinc-900 tracking-tight">Info de cuenta</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Avatar + name */}
            <div className="px-6 pb-6 text-center">
              <div className="w-[72px] h-[72px] mx-auto rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center text-[22px] font-semibold text-white shadow-lg shadow-[hsl(var(--brand-blue))]/20">
                {customerInitials}
              </div>
              <h4 className="mt-3 text-[15px] font-semibold text-zinc-900">{customerName}</h4>
              <p className="text-[12px] text-zinc-400 mt-0.5">
                {status === 'human_handoff' ? 'Control humano' : 'Agente IA activo'}
              </p>
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 space-y-2">
              <button
                onClick={() => { takeOver(); setShowInfoSheet(false); }}
                className={cn(
                  'w-full inline-flex items-center justify-center gap-2 h-11 rounded-2xl text-[13px] font-semibold transition-all active:scale-[0.98]',
                  status === 'human_handoff'
                    ? 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                    : 'bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 shadow-md shadow-[hsl(var(--brand-blue))]/25',
                )}
              >
                {status === 'human_handoff' ? (
                  <><Bot className="w-4 h-4" /> Devolver al bot</>
                ) : (
                  <><Hand className="w-4 h-4" /> Tomar control</>
                )}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="inline-flex items-center justify-center gap-2 h-11 rounded-2xl text-[13px] font-medium bg-zinc-50 text-zinc-700 hover:bg-zinc-100 transition-all active:scale-[0.98]">
                  <Phone className="w-4 h-4" /> Llamar
                </button>
                <button className="inline-flex items-center justify-center gap-2 h-11 rounded-2xl text-[13px] font-medium bg-zinc-50 text-zinc-700 hover:bg-zinc-100 transition-all active:scale-[0.98]">
                  <Video className="w-4 h-4" /> Video
                </button>
              </div>
            </div>

            {/* Details */}
            <div className="mx-5 rounded-2xl bg-zinc-50/80 divide-y divide-zinc-100/80">
              <div className="px-4 py-3.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 font-medium">Teléfono</p>
                <p className="text-[13px] text-zinc-800 mt-0.5 tabular-nums">{conversation.customer_phone}</p>
              </div>
              <div className="px-4 py-3.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 font-medium">Canal</p>
                <span className="inline-flex items-center mt-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[11px] font-medium capitalize">
                  {conversation.channel}
                </span>
              </div>
              <div className="px-4 py-3.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 font-medium">Estado</p>
                <span className={cn(
                  'inline-flex items-center mt-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  status === 'human_handoff'
                    ? 'bg-violet-50 text-violet-700'
                    : 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
                )}>
                  {status === 'human_handoff' ? 'Humano' : 'IA activo'}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div className="px-5 pt-5 pb-6">
              <ConversationNotes conversationId={conversation.id} initialNotes={initialNotes} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
