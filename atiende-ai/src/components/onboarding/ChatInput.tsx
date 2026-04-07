'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, FileText } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onUpload?: (file: File) => void;
  disabled?: boolean;
  uploading?: boolean;
  placeholder?: string;
  acceptsUpload?: boolean;
}

const ACCEPTED_TYPES = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_MB = 10;

export function ChatInput({
  onSend,
  onUpload,
  disabled = false,
  uploading = false,
  placeholder = 'Escribe tu respuesta...',
  acceptsUpload = false,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attached, setAttached] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled && !uploading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled, uploading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [value]);

  const handleSubmit = () => {
    if (disabled || uploading) return;
    if (attached && onUpload) {
      onUpload(attached);
      setAttached(null);
      setValue('');
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Archivo demasiado grande (max ${MAX_MB}MB)`);
      return;
    }
    if (!ACCEPTED_TYPES.split(',').includes(file.type)) {
      setError('Solo PDF, PNG, JPG o WEBP');
      return;
    }
    setAttached(file);
    // Reset input so selecting the same file twice still triggers change
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canSend = !disabled && !uploading && (attached !== null || value.trim().length > 0);

  return (
    <div className="animate-element animate-delay-200 w-full max-w-3xl mx-auto px-4">
      {/* Attached file preview */}
      {attached && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <FileText className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate text-emerald-900">{attached.name}</span>
          <span className="text-xs text-emerald-700">
            {(attached.size / 1024).toFixed(0)} KB
          </span>
          <button
            type="button"
            onClick={() => setAttached(null)}
            className="p-1 rounded-md hover:bg-emerald-100 text-emerald-700"
            aria-label="Quitar archivo"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-2 text-xs text-red-600 px-1" role="alert">
          {error}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-emerald-400 focus-within:shadow-[0_0_12px_rgba(16,185,129,0.15)] p-2">
        {/* File upload button */}
        {acceptsUpload && onUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Subir archivo"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading || attached !== null}
              className="p-2.5 rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-emerald-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              aria-label="Subir PDF o imagen"
              title="Subir PDF o imagen (menu, lista de precios, etc.)"
            >
              <Paperclip className="w-4 h-4" />
            </button>
          </>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={attached ? `Enviar "${attached.name}"...` : placeholder}
          disabled={disabled || uploading || attached !== null}
          rows={1}
          className="flex-1 bg-transparent text-sm px-3 py-2 resize-none focus:outline-none disabled:opacity-50 min-h-[40px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!canSend}
          className="p-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          aria-label={uploading ? 'Procesando archivo...' : 'Enviar'}
        >
          {uploading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
