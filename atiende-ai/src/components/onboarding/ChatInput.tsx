'use client';
import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled = false, placeholder = 'Escribe tu respuesta...' }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="animate-element animate-delay-200 w-full max-w-3xl mx-auto px-4">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-400 focus-within:shadow-[0_0_12px_rgba(0,0,0,0.1)] p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm px-3 py-2 resize-none focus:outline-none disabled:opacity-50 min-h-[40px]"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="p-2.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
