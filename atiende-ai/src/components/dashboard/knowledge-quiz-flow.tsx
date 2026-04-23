'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, Save, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Question } from '@/lib/onboarding/questions';
import type { Zone, ZoneId } from '@/lib/knowledge/zone-map';
import {
  SmartInsightCard,
  type SmartInsight,
} from '@/components/dashboard/smart-insight-card';

export interface KnowledgeQuizFlowProps {
  zone: Zone;
  questions: Question[];
  initialResponses: Record<string, unknown>;
  // Called after every successful save so parent can update `answeredKeys`
  // used by the zones grid to recompute completion rings in real time.
  onAnswered: (questionKey: string, value: unknown) => void;
  // Called when the user clicks the "next action" button inside a smart
  // insight — typically switches the open sheet to a different zone.
  onJumpZone?: (zoneId: ZoneId) => void;
}

type InsightState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'ready'; insight: SmartInsight; cached?: boolean; degraded?: boolean };

function answerAsString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if ('value' in obj) return answerAsString(obj.value);
    return JSON.stringify(obj);
  }
  return '';
}

function hasValue(v: unknown): boolean {
  const s = answerAsString(v).trim();
  return s.length > 0;
}

// Turn the editor's string draft back into the typed shape the API and
// downstream chunks expect. Keeps the save-answer contract permissive.
function draftToApiValue(q: Question, draft: string): unknown {
  const trimmed = draft.trim();
  if (q.type === 'boolean') {
    const t = trimmed.toLowerCase();
    if (['si', 'sí', 'yes', 'true', '1'].includes(t)) return true;
    if (['no', 'false', '0'].includes(t)) return false;
    return trimmed;
  }
  if (q.type === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (q.type === 'multi_select' || q.type === 'list') {
    return trimmed.split(/\s*,\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return trimmed;
}

export function KnowledgeQuizFlow({
  zone, questions, initialResponses, onAnswered, onJumpZone,
}: KnowledgeQuizFlowProps) {
  const [responses, setResponses] = useState<Record<string, unknown>>(initialResponses);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [insights, setInsights] = useState<Record<string, InsightState>>({});

  const startEdit = (q: Question) => {
    setDraft(answerAsString(responses[q.key]));
    setEditing(q.key);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const fetchInsight = async (q: Question, value: unknown) => {
    setInsights((m) => ({ ...m, [q.key]: { status: 'loading' } }));
    try {
      const res = await fetch('/api/knowledge/smart-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionKey: q.key,
          questionLabel: q.label,
          answer: answerAsString(value),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { insight: SmartInsight; cached?: boolean; degraded?: boolean };
      setInsights((m) => ({
        ...m,
        [q.key]: { status: 'ready', insight: json.insight, cached: json.cached, degraded: json.degraded },
      }));
    } catch {
      setInsights((m) => ({ ...m, [q.key]: { status: 'hidden' } }));
    }
  };

  const save = async (q: Question) => {
    setSaving(true);
    const apiValue = draftToApiValue(q, draft);
    try {
      const res = await fetch('/api/knowledge/save-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionKey: q.key,
          questionLabel: q.label,
          answer: apiValue,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { ok: boolean; warning?: string };

      setResponses((r) => ({ ...r, [q.key]: apiValue }));
      onAnswered(q.key, apiValue);
      setEditing(null);
      setDraft('');

      if (json.warning) {
        toast.warning(json.warning);
      } else {
        toast.success('Guardado. El agente ya usa esta respuesta.');
      }

      // Fire-and-forget insight fetch. Card mounts in loading state first.
      void fetchInsight(q, apiValue);
    } catch {
      toast.error('No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const filled = questions.filter((q) => hasValue(responses[q.key])).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-700">{zone.description}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            {filled} de {questions.length} respondidas
          </p>
        </div>
        <div className="w-28 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
          <div
            className="h-full bg-[hsl(var(--brand-blue))] transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${(filled / Math.max(questions.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {questions.map((q) => {
          const value = responses[q.key];
          const answered = hasValue(value);
          const isEditing = editing === q.key;
          const insight = insights[q.key] ?? { status: 'hidden' as const };

          return (
            <div key={q.key} className="rounded-2xl border border-zinc-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-900">{q.label}</p>
                    {q.required && !answered && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Requerido</span>
                    )}
                    {answered && !isEditing && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        <Check className="w-3 h-3" />
                        Respondida
                      </span>
                    )}
                  </div>
                  {q.help && !isEditing && (
                    <p className="text-[11.5px] text-zinc-500 mt-1">{q.help}</p>
                  )}
                </div>
                {!isEditing && (
                  <button
                    onClick={() => startEdit(q)}
                    className="text-xs inline-flex items-center gap-1 text-[hsl(var(--brand-blue))] hover:opacity-80"
                  >
                    <Pencil className="w-3 h-3" />
                    {answered ? 'Editar' : 'Responder'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2">
                  {q.type === 'textarea' || q.type === 'list' || q.type === 'multi_select' ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      placeholder={q.placeholder}
                      autoFocus
                      className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                    />
                  ) : (
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={q.placeholder}
                      autoFocus
                      className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                    />
                  )}
                  {q.options && q.options.length > 0 && (
                    <p className="text-[11px] text-zinc-400">
                      Opciones sugeridas: {q.options.join(', ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => save(q)}
                      disabled={saving || draft.trim().length === 0}
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg',
                        'bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50',
                      )}
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Guardar
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    >
                      <X className="w-3 h-3" />
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : answered ? (
                <pre className="mt-2 text-[13px] text-zinc-800 leading-relaxed whitespace-pre-wrap font-sans">
                  {answerAsString(value)}
                </pre>
              ) : (
                <p className="mt-1 text-xs text-zinc-400 italic">Sin respuesta aún.</p>
              )}

              {insight.status !== 'hidden' && !isEditing && (
                <div className="mt-3">
                  <SmartInsightCard
                    state={insight}
                    onNextAction={(zoneId) => zoneId && onJumpZone?.(zoneId)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
