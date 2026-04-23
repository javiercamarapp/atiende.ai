'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Loader2, Bot, Camera, Paperclip, Image as ImageIcon, X } from 'lucide-react';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  time: string;
  image?: string;
  fileName?: string;
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
  const [preview, setPreview] = useState<{ url: string; name: string; type: 'image' | 'file' } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'file') {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview({ url, name: file.name, type });
    e.target.value = '';
  }

  async function send() {
    const text = input.trim();
    if (!text && !preview) return;
    if (sending) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: text || (preview ? `[${preview.name}]` : ''),
      time: now(),
      image: preview?.type === 'image' ? preview.url : undefined,
      fileName: preview?.type === 'file' ? preview.name : undefined,
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setPreview(null);
    setSending(true);

    const messageToSend = text || (preview ? `El paciente envio ${preview.type === 'image' ? 'una foto' : `un archivo: ${preview.name}`}` : '');

    try {
      const res = await fetch('/api/knowledge/preview-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageToSend }),
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
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-1 pb-1.5 shrink-0">
        <Link
          href="/knowledge"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full hover:bg-zinc-100 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-zinc-500" />
        </Link>
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[hsl(235,84%,55%)] to-[hsl(255,84%,60%)] flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-zinc-900 leading-tight">Asistente atiende.ai</p>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-[9px] text-emerald-600 font-medium">En linea — modo prueba</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-2 space-y-1.5">
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
              {msg.image && (
                <img src={msg.image} alt="" className="rounded-lg mb-1.5 max-h-40 object-cover" />
              )}
              {msg.fileName && !msg.image && (
                <div className="flex items-center gap-2 mb-1.5 px-2 py-1.5 rounded-lg bg-white/20">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] truncate">{msg.fileName}</span>
                </div>
              )}
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

      {/* Preview bar */}
      {preview && (
        <div className="shrink-0 px-6 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="inline-flex items-center gap-2 rounded-xl bg-white shadow-sm px-3 py-1.5">
            {preview.type === 'image' ? (
              <img src={preview.url} alt="" className="w-10 h-10 rounded-lg object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Paperclip className="w-4 h-4 text-zinc-500" />
              </div>
            )}
            <span className="text-[11px] text-zinc-600 max-w-[150px] truncate">{preview.name}</span>
            <button onClick={() => setPreview(null)} className="w-5 h-5 rounded-full hover:bg-zinc-100 flex items-center justify-center transition">
              <X className="w-3 h-3 text-zinc-400" />
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 px-6 py-2">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, 'image')} />
          <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => handleFile(e, 'file')} />

          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition"
          >
            <Paperclip className="w-4 h-4" />
          </button>

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
            disabled={(!input.trim() && !preview) || sending}
            className="w-8 h-8 rounded-full bg-[hsl(235,84%,55%)] text-white flex items-center justify-center shadow-sm hover:bg-[hsl(235,84%,48%)] disabled:opacity-40 transition-all"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
