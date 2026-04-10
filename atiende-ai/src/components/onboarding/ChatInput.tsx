'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, ImageIcon, FileText } from 'lucide-react';

export interface AttachedFilePreview {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'ready' | 'error';
  errorMessage?: string;
}

interface ChatInputProps {
  onSend: (message: string, files: File[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Max files attached at once (default 3). */
  maxFiles?: number;
  /** Max bytes per file (default 4MB). */
  maxBytes?: number;
  /** Accepted MIME types (default: PNG/JPG/WebP). */
  acceptedTypes?: string[];
}

const DEFAULT_ACCEPTED = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
];
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Escribe tu respuesta...',
  maxFiles = 3,
  maxBytes = DEFAULT_MAX_BYTES,
  acceptedTypes = DEFAULT_ACCEPTED,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFilePreview[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachError(null);
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;

    const newFiles: AttachedFilePreview[] = [];
    const errors: string[] = [];
    for (const file of Array.from(picked)) {
      if (attachedFiles.length + newFiles.length >= maxFiles) {
        errors.push(`Máximo ${maxFiles} archivos por mensaje.`);
        break;
      }
      if (!acceptedTypes.includes(file.type)) {
        errors.push(`${file.name}: tipo no soportado (PNG, JPG, WebP o PDF).`);
        continue;
      }
      if (file.size > maxBytes) {
        const mb = (maxBytes / 1024 / 1024).toFixed(0);
        errors.push(`${file.name}: excede ${mb}MB.`);
        continue;
      }
      newFiles.push({
        id: `f-${Date.now()}-${Math.random()}`,
        file,
        status: 'pending',
      });
    }

    if (errors.length > 0) setAttachError(errors.join(' '));
    if (newFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
    // Reset input so picking the same file again fires change.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    // Allow empty text if there are attachments — user can "send" a file alone.
    if (!trimmed && attachedFiles.length === 0) return;
    if (disabled) return;

    const filesToSend = attachedFiles.map((a) => a.file);
    // Use a default message if the user only sent files.
    const messageToSend = trimmed || 'Te mandé un archivo, míralo porfa.';
    onSend(messageToSend, filesToSend);
    setValue('');
    setAttachedFiles([]);
    setAttachError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = !disabled && (value.trim().length > 0 || attachedFiles.length > 0);

  return (
    <div className="animate-element animate-delay-200 w-full max-w-3xl mx-auto px-4">
      {/* Attached file previews */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedFiles.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-1.5 text-xs"
            >
              {att.file.type === 'application/pdf' ? (
                <FileText className="w-3.5 h-3.5 text-zinc-600" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 text-zinc-600" />
              )}
              <span className="max-w-[180px] truncate text-zinc-800">
                {att.file.name}
              </span>
              <span className="text-zinc-500">
                {(att.file.size / 1024).toFixed(0)}KB
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                disabled={disabled}
                className="text-zinc-500 hover:text-zinc-900 disabled:opacity-30"
                aria-label="Remover archivo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attach error message */}
      {attachError && (
        <div className="text-xs text-red-600 mb-2">{attachError}</div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-400 focus-within:shadow-[0_0_12px_rgba(0,0,0,0.1)] p-2">
        {/* Paperclip (hidden file input) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachedFiles.length >= maxFiles}
          className="p-2.5 rounded-xl text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          aria-label="Adjuntar archivo"
          title="Adjuntar foto, imagen o PDF"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes.join(',')}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

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
          disabled={!canSend}
          className="p-2.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          aria-label="Enviar"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
