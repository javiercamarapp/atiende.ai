'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StickyNote, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export interface ConversationNote {
  id: string;
  text: string;
  created_at: string;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function ConversationNotes({
  conversationId,
  initialNotes,
}: {
  conversationId: string;
  initialNotes: ConversationNote[];
}) {
  const [notes, setNotes] = useState<ConversationNote[]>(initialNotes);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const saveNote = async () => {
    const text = draft.trim();
    if (!text || saving) return;

    setSaving(true);
    const newNote: ConversationNote = {
      id: crypto.randomUUID(),
      text,
      created_at: new Date().toISOString(),
    };
    const updatedNotes = [newNote, ...notes];

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ notes: updatedNotes })
        .eq('id', conversationId);
      if (error) throw error;
      setNotes(updatedNotes);
      setDraft('');
      toast.success('Nota guardada');
    } catch {
      toast.error('Error al guardar nota');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Notas internas
        </span>
        {notes.length > 0 && (
          <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-medium">
            {notes.length}
          </span>
        )}
        <span className="ml-auto">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Add note form */}
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escribe una nota interna..."
              className="min-h-[60px] text-sm bg-muted/50 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveNote();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                Ctrl+Enter para guardar
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={saveNote}
                disabled={!draft.trim() || saving}
                className="h-7 text-xs"
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : null}
                Guardar nota
              </Button>
            </div>
          </div>

          {/* Notes list (reverse chronological) */}
          {notes.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-md bg-muted/60 border border-border/50 px-3 py-2"
                >
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {note.text}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {relativeTime(note.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {notes.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              Sin notas internas aun
            </p>
          )}
        </div>
      )}
    </div>
  );
}
