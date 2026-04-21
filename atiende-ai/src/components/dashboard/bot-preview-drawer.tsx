'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  MessageCircle, Send, MoreHorizontal, Loader2,
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck, Bot, CheckCheck, Pencil, X,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import type { ZoneId } from '@/lib/knowledge/zone-map';

const ZONE_ICONS = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} as const satisfies Record<string, React.ComponentType<{ className?: string }>>;

type Source = {
  zoneId: ZoneId;
  zoneTitle: string;
  zoneIcon: string;
  questionKey?: string;
};

type UserMessage = { id: string; role: 'user'; content: string };
type BotMessage = {
  id: string;
  role: 'bot';
  content: string;
  sources: Source[];
  replyTo: string;   // the user message id that triggered this reply
  reported?: boolean;
  correcting?: boolean;
};
type Message = UserMessage | BotMessage;

// Floating button that pops open the preview drawer. Fixed bottom-right
// so the owner can sanity-check the bot from any page without losing
// context. Only rendered when the parent mounts <BotPreview />.
export function BotPreviewFAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Probar bot"
      className={cn(
        'fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-full',
        'bg-[hsl(var(--brand-blue))] text-white shadow-lg shadow-[hsl(var(--brand-blue))]/25',
        'hover:scale-[1.02] active:scale-95 transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-blue))] focus-visible:ring-offset-2',
      )}
    >
      <MessageCircle className="w-4 h-4" strokeWidth={2} />
      <span className="text-sm font-medium">Probar bot</span>
    </button>
  );
}

export interface BotPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Side/bottom drawer that calls /api/knowledge/preview-chat and renders
// a lightweight chat UI with source-chip attribution + per-reply
// correction menu. Writes to /api/knowledge/report-correction when the
// owner submits a fix — that FAQ chunk is immediately available to the
// real WhatsApp bot via the shared knowledge_chunks table.
export function BotPreview({ open, onOpenChange }: BotPreviewProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');
  const side: 'bottom' | 'right' = isMobile ? 'bottom' : 'right';

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [botName, setBotName] = useState('Asistente');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: UserMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/knowledge/preview-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (res.status === 429) {
        toast.error('Llegaste al límite de pruebas por hoy. Inténtalo mañana.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        reply: string;
        sources: Source[];
        botName: string;
      };
      setBotName(json.botName);
      setMessages((m) => [
        ...m,
        {
          id: `b-${Date.now()}`,
          role: 'bot',
          content: json.reply,
          sources: json.sources ?? [],
          replyTo: userMsg.id,
        },
      ]);
    } catch {
      toast.error('No se pudo responder. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const toggleCorrecting = (botMsgId: string) => {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === botMsgId && msg.role === 'bot'
          ? { ...msg, correcting: !msg.correcting }
          : msg,
      ),
    );
  };

  const submitCorrection = async (botMsg: BotMessage, correctResponse: string) => {
    const originalUser = messages.find((m) => m.id === botMsg.replyTo);
    if (!originalUser || originalUser.role !== 'user') return;

    try {
      const res = await fetch('/api/knowledge/report-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerMessage: originalUser.content,
          correctResponse,
          saveAsFaq: true,
        }),
      });
      const json = (await res.json()) as { ok: boolean; warning?: string };
      if (!res.ok) throw new Error();
      if (json.warning) {
        toast.warning(json.warning);
      } else {
        toast.success('Gracias. El bot ya aprendió la respuesta correcta.');
      }
      setMessages((m) =>
        m.map((msg) =>
          msg.id === botMsg.id && msg.role === 'bot'
            ? { ...msg, reported: true, correcting: false }
            : msg,
        ),
      );
    } catch {
      toast.error('No se pudo guardar la corrección.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          'p-0 overflow-hidden flex flex-col bg-white',
          isMobile
            ? 'h-[92svh] rounded-t-3xl sm:max-w-none'
            : 'w-full sm:max-w-md',
        )}
      >
        <div className="px-5 pt-5 pb-3 border-b border-zinc-100 flex items-center gap-3">
          <span className="inline-flex w-10 h-10 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] items-center justify-center">
            <Bot className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 pr-10">
            <p className="text-sm font-semibold text-zinc-900 truncate">Probar bot en vivo</p>
            <p className="text-[11px] text-zinc-500 truncate">
              Conversación de prueba con {botName}. Las correcciones entrenan al bot real.
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-zinc-50/40">
          {messages.length === 0 && (
            <div className="text-center py-10">
              <MessageCircle className="w-9 h-9 text-zinc-300 mx-auto" strokeWidth={1.5} />
              <p className="mt-3 text-sm text-zinc-500">Escribe lo que un cliente preguntaría…</p>
              <p className="mt-1 text-xs text-zinc-400">Ej: &ldquo;¿A qué hora abren?&rdquo; · &ldquo;¿Cuánto cuesta una limpieza?&rdquo;</p>
            </div>
          )}

          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[hsl(var(--brand-blue))] text-white px-3.5 py-2 text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex flex-col items-start gap-1.5 max-w-[85%]">
                <div className="rounded-2xl rounded-bl-md bg-white border border-zinc-100 px-3.5 py-2 text-sm text-zinc-800 leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>

                {msg.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {msg.sources.map((s) => {
                      const Icon = ZONE_ICONS[s.zoneIcon as keyof typeof ZONE_ICONS] ?? Sparkles;
                      return (
                        <span
                          key={s.zoneId + (s.questionKey ?? '')}
                          className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600"
                        >
                          <Icon className="w-2.5 h-2.5" strokeWidth={1.75} />
                          {s.zoneTitle}
                        </span>
                      );
                    })}
                  </div>
                )}

                {!msg.reported && !msg.correcting && (
                  <button
                    onClick={() => toggleCorrecting(msg.id)}
                    className="text-[10.5px] text-zinc-400 hover:text-zinc-700 inline-flex items-center gap-1 pl-1"
                    aria-label="Reportar respuesta incorrecta"
                  >
                    <MoreHorizontal className="w-3 h-3" />
                    Corregir
                  </button>
                )}

                {msg.reported && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 pl-1">
                    <CheckCheck className="w-3 h-3" />
                    Corrección guardada
                  </span>
                )}

                {msg.correcting && (
                  <CorrectionForm
                    onCancel={() => toggleCorrecting(msg.id)}
                    onSubmit={(text) => submitCorrection(msg, text)}
                  />
                )}
              </div>
            ),
          )}

          {loading && (
            <div className="flex items-center gap-2 text-zinc-400 text-xs pl-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Pensando…
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Escribe un mensaje…"
              className="flex-1 resize-none text-sm rounded-2xl bg-zinc-50 border border-zinc-200 px-3 py-2 max-h-32 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
            />
            <button
              onClick={() => void send()}
              disabled={loading || input.trim().length === 0}
              className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[hsl(var(--brand-blue))] text-white disabled:opacity-40 hover:opacity-90 transition shrink-0"
              aria-label="Enviar"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2} />}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CorrectionForm({
  onCancel, onSubmit,
}: { onCancel: () => void; onSubmit: (text: string) => void | Promise<void> }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="w-full rounded-2xl border border-zinc-100 bg-white p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Pencil className="w-3 h-3 text-[hsl(var(--brand-blue))]" />
        <p className="text-[11px] font-medium text-zinc-700">¿Cuál era la respuesta correcta?</p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="Escribe la respuesta que el bot debería haber dado…"
        className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
      />
      <div className="flex items-center gap-1.5">
        <button
          onClick={async () => {
            setSubmitting(true);
            await onSubmit(text.trim());
            setSubmitting(false);
          }}
          disabled={submitting || text.trim().length === 0}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-[hsl(var(--brand-blue))] text-white disabled:opacity-50 hover:opacity-90"
        >
          {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
          Guardar corrección
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
        >
          <X className="w-3 h-3" />
          Cancelar
        </button>
      </div>
    </div>
  );
}
