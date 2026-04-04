'use client';
import { Monitor, MessageCircle } from 'lucide-react';

interface ChannelSelectorProps {
  onSelect: (channel: 'web' | 'whatsapp') => void;
}

export function ChannelSelector({ onSelect }: ChannelSelectorProps) {
  return (
    <div className="flex flex-col items-center gap-8 animate-element animate-delay-300">
      <p className="text-muted-foreground text-sm">Elige como quieres configurar tu agente AI</p>
      <div className="flex gap-4">
        <button
          onClick={() => onSelect('web')}
          className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl border border-border bg-foreground/5 hover:bg-zinc-900 hover:text-white transition-all duration-300 group"
        >
          <Monitor className="w-8 h-8 text-zinc-600 group-hover:text-white transition-colors" />
          <span className="font-medium text-sm">Web</span>
        </button>
        <button
          onClick={() => onSelect('whatsapp')}
          className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl border border-border bg-foreground/5 hover:bg-zinc-900 hover:text-white transition-all duration-300 group"
        >
          <MessageCircle className="w-8 h-8 text-zinc-600 group-hover:text-white transition-colors" />
          <span className="font-medium text-sm">WhatsApp</span>
        </button>
      </div>
    </div>
  );
}
