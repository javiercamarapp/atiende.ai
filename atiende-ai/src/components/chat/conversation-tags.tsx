'use client';

import { useState, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { X, Plus, Tag } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const TAG_SUGGESTIONS = ['VIP', 'Queja', 'Oportunidad', 'Urgente', 'Seguimiento'] as const;

const TAG_COLORS: Record<string, string> = {
  vip: 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200',
  queja: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200',
  oportunidad: 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200',
  urgente: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200',
  seguimiento: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200',
};

function getTagClasses(tag: string): string {
  return TAG_COLORS[tag.toLowerCase()] ?? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200';
}

export function ConversationTags({
  conversationId,
  initialTags,
}: {
  conversationId: string;
  initialTags: string[];
}) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const saveTags = async (newTags: string[]) => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ tags: newTags })
        .eq('id', conversationId);
      if (error) throw error;
      toast.success('Etiquetas actualizadas');
    } catch {
      toast.error('Error al guardar etiquetas');
    } finally {
      setSaving(false);
    }
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.some((t) => t.toLowerCase() === trimmed.toLowerCase()))
      return;
    const newTags = [...tags, trimmed];
    setTags(newTags);
    setInput('');
    setShowSuggestions(false);
    saveTags(newTags);
  };

  const removeTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    saveTags(newTags);
  };

  const unusedSuggestions = TAG_SUGGESTIONS.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Etiquetas
        </span>
        {saving && (
          <span className="text-[10px] text-muted-foreground animate-pulse">
            Guardando...
          </span>
        )}
      </div>

      {/* Current tags */}
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className={`gap-1 pr-1 text-xs cursor-default ${getTagClasses(tag)}`}
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
              aria-label={`Quitar ${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {/* Add input */}
        <div className="relative">
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(input);
                }
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Agregar..."
              className="h-7 w-28 text-xs"
            />
          </div>

          {/* Suggestions dropdown */}
          {showSuggestions && unusedSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-10 bg-white border rounded-md shadow-lg py-1 min-w-[160px]">
              <p className="px-2 py-1 text-[10px] text-muted-foreground font-medium">
                Sugerencias
              </p>
              {unusedSuggestions
                .filter(
                  (s) =>
                    !input || s.toLowerCase().includes(input.toLowerCase())
                )
                .map((suggestion) => (
                  <button
                    key={suggestion}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs hover:bg-gray-50 transition-colors text-left"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(suggestion);
                    }}
                  >
                    <Plus className="h-3 w-3 text-muted-foreground" />
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getTagClasses(suggestion)}`}
                    >
                      {suggestion}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
