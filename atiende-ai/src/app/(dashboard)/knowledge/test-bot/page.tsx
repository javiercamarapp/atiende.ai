'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Loader2, Bot } from 'lucide-react';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  time: string;
}

function now() {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export default function TestBotPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'bot',
      text: 'Hola, soy tu asistente virtual. Escribe cualquier pregunta para probar como respondo a tus pacientes.',
      time: now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text, time: now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/knowledge/preview-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { id: `b-${Date.now()}`, role: 'bot', text: data.reply || data.error || 'No pude generar una respuesta.', time: now() },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: 'bot', text: 'Error de conexion. Intenta de nuevo.', time: now() },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      {/* Header — inline, no background */}
      <div className="flex items-center gap-3 px-6 py-2.5 shrink-0">
        <Link
          href="/knowledge"
          className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-100 transition"
        >
          <ArrowLeft className="w-4 h-4 text-zinc-500" />
        </Link>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(235,84%,55%)] to-[hsl(255,84%,60%)] flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-zinc-900">Asistente atiende.ai</p>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-[10px] text-emerald-600 font-medium">En linea — modo prueba</p>
          </div>
        </div>
      </div>

      {/* Messages — directly on page background */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            <div
              className={`max-w-[65%] rounded-2xl px-3.5 py-2 ${
                msg.role === 'user'
                  ? 'bg-[hsl(235,84%,55%)] text-white rounded-br-sm shadow-sm shadow-[hsl(235,84%,55%)]/20'
                  : 'bg-white text-zinc-800 rounded-bl-sm shadow-sm'
              }`}
            >
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              <p className={`text-[9px] mt-0.5 text-right ${msg.role === 'user' ? 'text-white/50' : 'text-zinc-400'}`}>
                {msg.time}
              </p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — no background, just the field */}
      <div className="shrink-0 px-6 py-2.5">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe un mensaje..."
            disabled={sending}
            autoFocus
            className="flex-1 text-[13px] rounded-full bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[hsl(235,84%,55%)]/20 transition placeholder:text-zinc-400 shadow-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-full bg-[hsl(235,84%,55%)] text-white flex items-center justify-center shadow-sm hover:bg-[hsl(235,84%,48%)] disabled:opacity-40 transition-all"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
