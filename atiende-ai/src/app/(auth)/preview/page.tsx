'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, Phone, Video, MoreVertical, CheckCheck, Loader2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

function nowLabel(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function PreviewPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [botName, setBotName] = useState('Tu agente');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      time: nowLabel(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setIsTyping(true);
    setError(null);

    try {
      const res = await fetch('/api/preview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || 'No pudimos obtener respuesta.');
        setIsTyping(false);
        return;
      }
      if (json.botName) setBotName(json.botName);
      if (json.businessName) setBusinessName(json.businessName);

      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: json.reply || '…',
          time: nowLabel(),
        },
      ]);
    } catch {
      setError('Error de red. Inténtalo de nuevo.');
    } finally {
      setIsTyping(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage();
  }

  const initials = (businessName || botName || 'A')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-zinc-100">
      {/* Top bar (outside WhatsApp) */}
      <div className="px-6 py-4 bg-white border-b border-zinc-100">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            href="/onboarding/connect"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <span className="text-xs text-zinc-400 font-mono">preview · no se envía a WhatsApp</span>
        </div>
      </div>

      {/* WhatsApp frame */}
      <div className="flex-1 flex items-stretch justify-center p-0 md:p-6">
        <div className="w-full max-w-md bg-white md:rounded-3xl md:shadow-2xl overflow-hidden flex flex-col animate-element animate-delay-100">
          {/* WhatsApp header */}
          <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-semibold text-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{businessName || botName}</p>
              <p className="text-[11px] text-white/70">
                {isTyping ? 'escribiendo…' : 'en línea'}
              </p>
            </div>
            <Video className="w-5 h-5 opacity-80" />
            <Phone className="w-5 h-5 opacity-80" />
            <MoreVertical className="w-5 h-5 opacity-80" />
          </div>

          {/* Chat area */}
          <div
            className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2"
            style={{
              backgroundColor: '#ECE5DD',
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4) 0, transparent 50%), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.3) 0, transparent 50%)',
              minHeight: '60vh',
            }}
          >
            {messages.length === 0 && !isTyping && (
              <div className="text-center mt-8 px-6">
                <div className="inline-block bg-[#FFF3C4] text-zinc-700 text-xs px-3 py-1.5 rounded-lg shadow-sm">
                  Escribe un mensaje para probar cómo responde tu agente
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-element`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-[#DCF8C6] text-zinc-900 rounded-tr-sm'
                      : 'bg-white text-zinc-900 rounded-tl-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-zinc-400">{msg.time}</span>
                    {msg.role === 'user' && (
                      <CheckCheck className="w-3 h-3 text-[#34B7F1]" />
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white px-3 py-2.5 rounded-lg rounded-tl-sm shadow-sm inline-flex items-end gap-1">
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="bg-[#F0F0F0] px-3 py-2 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe un mensaje"
              disabled={isTyping}
              maxLength={500}
              className="flex-1 px-4 py-2.5 rounded-full bg-white text-sm focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="w-10 h-10 rounded-full bg-[#075E54] text-white flex items-center justify-center hover:bg-[#064c44] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isTyping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      </div>

      {error && (
        <div className="px-6 pb-4">
          <div className="max-w-2xl mx-auto text-xs text-red-600 text-center">{error}</div>
        </div>
      )}
    </div>
  );
}
