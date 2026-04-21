'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, CheckCheck, Loader2, Sparkles, ChevronDown, Pencil, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Candidate = {
  id: string;
  customer_message: string;
  bot_response: string;
  detection_reason: string | null;
  created_at: string;
};

const REASON_LABEL: Record<string, string> = {
  missing_info: 'Respuesta vaga',
  explicit_hedge: 'Bot dudó',
  deferred_answer: 'Bot postergó',
  deflect: 'Bot desvió',
  apology: 'Bot se disculpó',
  too_short: 'Respuesta corta',
  unknown: 'Revisión manual',
};

// Shown above the zone grid when the sweep/live-detection populated
// review_candidates. Gives the owner a pointed list of conversations where
// the bot likely dodged the question — a ~10-second interaction per item
// teaches the correct answer and writes a tagged FAQ chunk to
// knowledge_chunks, immediately usable by the live bot.
export function ConversationReviewWidget() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Candidate[]>([]);
  const [reviewedThisWeek, setReviewedThisWeek] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/knowledge/review-candidates');
      if (!res.ok) throw new Error();
      const json = (await res.json()) as {
        items: Candidate[];
        reviewedThisWeek: number;
      };
      setItems(json.items ?? []);
      setReviewedThisWeek(json.reviewedThisWeek ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (candidateId: string) => {
    const text = draft.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/knowledge/report-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId,
          correctResponse: text,
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
      setItems((list) => list.filter((c) => c.id !== candidateId));
      setReviewedThisWeek((n) => n + 1);
      setOpenId(null);
      setDraft('');
    } catch {
      toast.error('No se pudo guardar la corrección.');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading: thin skeleton that matches the collapsed height. Hidden
  // entirely if there's nothing to review and nothing reviewed this week.
  if (loading) {
    return (
      <div className="glass-card animate-pulse">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-zinc-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded bg-zinc-100" />
            <div className="h-2.5 w-56 rounded bg-zinc-100" />
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0 && reviewedThisWeek === 0) return null;

  return (
    <section className="glass-card overflow-hidden animate-element animate-delay-100">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-start gap-3">
        <span className="inline-flex w-9 h-9 rounded-full bg-amber-50 text-amber-600 items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-zinc-900">
              {items.length > 0
                ? `${items.length} conversación${items.length === 1 ? '' : 'es'} para revisar`
                : 'Todo al día — sin pendientes'}
            </p>
            {reviewedThisWeek > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                <CheckCheck className="w-3 h-3" />
                {reviewedThisWeek} corregida{reviewedThisWeek === 1 ? '' : 's'} esta semana
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            El bot dudó en estas preguntas. Corregir una toma ~10 segundos y el bot aprende al instante.
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {items.map((c) => {
            const open = openId === c.id;
            const reasonLabel = REASON_LABEL[c.detection_reason ?? 'unknown'] ?? 'Revisión manual';
            return (
              <li key={c.id} className="px-5 py-4">
                <button
                  onClick={() => {
                    if (open) {
                      setOpenId(null);
                      setDraft('');
                    } else {
                      setOpenId(c.id);
                      setDraft('');
                    }
                  }}
                  className="w-full text-left flex items-start gap-3"
                  aria-expanded={open}
                >
                  <Sparkles className="w-4 h-4 mt-0.5 text-[hsl(var(--brand-blue))] shrink-0" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {reasonLabel}
                      </span>
                      <span className="text-[10.5px] text-zinc-400">
                        {new Date(c.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <p className="text-[13px] text-zinc-800 leading-relaxed">
                      <span className="text-zinc-400">Cliente:</span> “{c.customer_message}”
                    </p>
                    <p className="text-[13px] text-zinc-500 leading-relaxed">
                      <span className="text-zinc-400">Bot:</span> {c.bot_response}
                    </p>
                  </div>
                  <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform mt-0.5', open && 'rotate-180')} />
                </button>

                {open && (
                  <div className="mt-3 pl-7 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Pencil className="w-3 h-3 text-[hsl(var(--brand-blue))]" />
                      <p className="text-[11px] font-medium text-zinc-700">
                        ¿Cuál era la respuesta correcta?
                      </p>
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      autoFocus
                      placeholder="Escribe la respuesta que el bot debería haber dado…"
                      className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void submit(c.id)}
                        disabled={submitting || draft.trim().length === 0}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-[hsl(var(--brand-blue))] text-white disabled:opacity-50 hover:opacity-90"
                      >
                        {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                        Guardar corrección
                      </button>
                      <button
                        onClick={() => {
                          setOpenId(null);
                          setDraft('');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      >
                        <X className="w-3 h-3" />
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
