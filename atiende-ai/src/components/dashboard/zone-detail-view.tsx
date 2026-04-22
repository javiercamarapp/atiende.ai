'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck,
  Star, Compass, Palette, Truck, Check, Pencil, Save, X, Loader2,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Question } from '@/lib/onboarding/questions';
import {
  ZONES,
  type Zone,
  type ZoneId,
  computeZoneCompletion,
  getVisibleZones,
  getQuestionsForZone,
} from '@/lib/knowledge/zone-map';
import {
  SmartInsightCard,
  type SmartInsight,
} from '@/components/dashboard/smart-insight-card';

const ICONS = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} as const satisfies Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>;

const ACCENT: Record<string, {
  ring: string; text: string; bg: string; softBg: string;
  gradFrom: string; gradTo: string; border: string; focus: string;
}> = {
  blue:    { ring: 'stroke-blue-500',    text: 'text-blue-600',    bg: 'bg-blue-500',    softBg: 'bg-blue-50',    gradFrom: 'from-blue-50',    gradTo: 'to-white', border: 'border-blue-200',    focus: 'focus:ring-blue-200' },
  violet:  { ring: 'stroke-violet-500',  text: 'text-violet-600',  bg: 'bg-violet-500',  softBg: 'bg-violet-50',  gradFrom: 'from-violet-50',  gradTo: 'to-white', border: 'border-violet-200',  focus: 'focus:ring-violet-200' },
  emerald: { ring: 'stroke-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-500', softBg: 'bg-emerald-50', gradFrom: 'from-emerald-50', gradTo: 'to-white', border: 'border-emerald-200', focus: 'focus:ring-emerald-200' },
  orange:  { ring: 'stroke-orange-500',  text: 'text-orange-600',  bg: 'bg-orange-500',  softBg: 'bg-orange-50',  gradFrom: 'from-orange-50',  gradTo: 'to-white', border: 'border-orange-200',  focus: 'focus:ring-orange-200' },
  amber:   { ring: 'stroke-amber-500',   text: 'text-amber-600',   bg: 'bg-amber-500',   softBg: 'bg-amber-50',   gradFrom: 'from-amber-50',   gradTo: 'to-white', border: 'border-amber-200',   focus: 'focus:ring-amber-200' },
  indigo:  { ring: 'stroke-indigo-500',  text: 'text-indigo-600',  bg: 'bg-indigo-500',  softBg: 'bg-indigo-50',  gradFrom: 'from-indigo-50',  gradTo: 'to-white', border: 'border-indigo-200',  focus: 'focus:ring-indigo-200' },
  rose:    { ring: 'stroke-rose-500',    text: 'text-rose-600',    bg: 'bg-rose-500',    softBg: 'bg-rose-50',    gradFrom: 'from-rose-50',    gradTo: 'to-white', border: 'border-rose-200',    focus: 'focus:ring-rose-200' },
  teal:    { ring: 'stroke-teal-500',    text: 'text-teal-600',    bg: 'bg-teal-500',    softBg: 'bg-teal-50',    gradFrom: 'from-teal-50',    gradTo: 'to-white', border: 'border-teal-200',    focus: 'focus:ring-teal-200' },
  fuchsia: { ring: 'stroke-fuchsia-500', text: 'text-fuchsia-600', bg: 'bg-fuchsia-500', softBg: 'bg-fuchsia-50', gradFrom: 'from-fuchsia-50', gradTo: 'to-white', border: 'border-fuchsia-200', focus: 'focus:ring-fuchsia-200' },
  cyan:    { ring: 'stroke-cyan-500',    text: 'text-cyan-600',    bg: 'bg-cyan-500',    softBg: 'bg-cyan-50',    gradFrom: 'from-cyan-50',    gradTo: 'to-white', border: 'border-cyan-200',    focus: 'focus:ring-cyan-200' },
};

export interface ZoneDetailViewProps {
  zone: Zone;
  questions: Question[];
  allQuestions: Question[];
  initialResponses: Record<string, unknown>;
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
  return answerAsString(v).trim().length > 0;
}

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

export function ZoneDetailView({ zone, questions, allQuestions, initialResponses }: ZoneDetailViewProps) {
  const router = useRouter();
  const accent = ACCENT[zone.accent] ?? ACCENT.blue;
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;

  const [responses, setResponses] = useState<Record<string, unknown>>(initialResponses);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [insights, setInsights] = useState<Record<string, InsightState>>({});

  const answeredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(responses)) {
      if (hasValue(value)) set.add(key);
    }
    return set;
  }, [responses]);

  const completion = useMemo(
    () => computeZoneCompletion(zone.id, allQuestions, answeredKeys),
    [zone.id, allQuestions, answeredKeys],
  );

  const filled = questions.filter((q) => hasValue(responses[q.key])).length;
  const CIRC = 100;
  const dashOffset = CIRC - (completion.percent / 100) * CIRC;

  const siblingZones = useMemo(() => {
    const visible = getVisibleZones(allQuestions);
    const idx = visible.findIndex((z) => z.id === zone.id);
    const prev = idx > 0 ? visible[idx - 1] : null;
    const next = idx < visible.length - 1 ? visible[idx + 1] : null;
    return { prev, next };
  }, [allQuestions, zone.id]);

  const startEdit = (q: Question) => {
    setDraft(answerAsString(responses[q.key]));
    setEditing(q.key);
  };
  const cancelEdit = () => { setEditing(null); setDraft(''); };

  const fetchInsight = useCallback(async (q: Question, value: unknown) => {
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
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { insight: SmartInsight; cached?: boolean; degraded?: boolean };
      setInsights((m) => ({
        ...m,
        [q.key]: { status: 'ready', insight: json.insight, cached: json.cached, degraded: json.degraded },
      }));
    } catch {
      setInsights((m) => ({ ...m, [q.key]: { status: 'hidden' } }));
    }
  }, []);

  const save = useCallback(async (q: Question) => {
    setSaving(true);
    const apiValue = draftToApiValue(q, draft);
    try {
      const res = await fetch('/api/knowledge/save-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionKey: q.key, questionLabel: q.label, answer: apiValue }),
      });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { ok: boolean; warning?: string };
      setResponses((r) => ({ ...r, [q.key]: apiValue }));
      setEditing(null);
      setDraft('');
      if (json.warning) toast.warning(json.warning);
      else toast.success('Guardado');
      void fetchInsight(q, apiValue);
    } catch {
      toast.error('No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }, [draft, fetchInsight]);

  return (
    <div className="max-w-2xl mx-auto pb-8 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Back + nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push('/knowledge')}
          className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-800 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Conocimiento
        </button>
        <div className="flex items-center gap-1">
          {siblingZones.prev && (
            <NavPill
              zone={siblingZones.prev}
              direction="prev"
              allQuestions={allQuestions}
              onClick={() => router.push(`/knowledge/${siblingZones.prev!.id}`)}
            />
          )}
          {siblingZones.next && (
            <NavPill
              zone={siblingZones.next}
              direction="next"
              allQuestions={allQuestions}
              onClick={() => router.push(`/knowledge/${siblingZones.next!.id}`)}
            />
          )}
        </div>
      </div>

      {/* Hero card */}
      <section className={cn(
        'rounded-3xl border border-zinc-200/60 bg-gradient-to-br overflow-hidden',
        'shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]',
        accent.gradFrom, accent.gradTo,
      )}>
        <div className="px-6 py-8 flex flex-col items-center text-center">
          {/* Animated ring */}
          <div className="relative w-20 h-20 mb-4">
            <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90 drop-shadow-sm">
              <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-white/60" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.9155" fill="none"
                className={cn(accent.ring, 'transition-[stroke-dashoffset] duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
                strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={dashOffset}
              />
            </svg>
            <span className={cn(
              'absolute inset-0 flex items-center justify-center',
              completion.percent >= 100 ? accent.text : '',
            )}>
              {completion.percent >= 100 ? (
                <Check className="w-7 h-7" strokeWidth={2} />
              ) : (
                <Icon className={cn('w-7 h-7', accent.text)} strokeWidth={1.5} />
              )}
            </span>
          </div>

          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">{zone.title}</h1>
          <p className="text-[13px] text-zinc-500 mt-1 max-w-xs">{zone.description}</p>

          {/* Progress bar */}
          <div className="mt-5 w-full max-w-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-zinc-500 tabular-nums">
                {filled} de {questions.length} respondidas
              </span>
              <span className={cn('text-[11px] font-bold tabular-nums', accent.text)}>
                {completion.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/80 overflow-hidden shadow-inner">
              <div
                className={cn(accent.bg, 'h-full rounded-full transition-all duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
                style={{ width: `${completion.percent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Questions */}
      <div className="mt-5 space-y-3">
        {questions.map((q, i) => {
          const value = responses[q.key];
          const answered = hasValue(value);
          const isEditing = editing === q.key;
          const insight = insights[q.key] ?? { status: 'hidden' as const };

          return (
            <div
              key={q.key}
              className={cn(
                'rounded-2xl border bg-white/90 backdrop-blur-sm overflow-hidden transition-all duration-300',
                'shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
                isEditing ? cn(accent.border, 'shadow-[0_0_0_3px_rgba(0,0,0,0.02)]') : 'border-zinc-100 hover:border-zinc-200',
                'animate-in fade-in slide-in-from-bottom-2',
              )}
              style={{ animationDelay: `${80 + i * 60}ms`, animationFillMode: 'backwards' }}
            >
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'inline-flex w-5 h-5 rounded-full items-center justify-center shrink-0 text-[10px] font-bold',
                        answered ? cn(accent.softBg, accent.text) : 'bg-zinc-100 text-zinc-400',
                      )}>
                        {answered ? <Check className="w-3 h-3" /> : i + 1}
                      </span>
                      <p className="text-[14px] font-medium text-zinc-900">{q.label}</p>
                    </div>
                    {q.help && !isEditing && (
                      <p className="text-[12px] text-zinc-400 mt-1 ml-7">{q.help}</p>
                    )}
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(q)}
                      className={cn(
                        'text-[12px] inline-flex items-center gap-1 font-medium transition-colors shrink-0',
                        answered ? 'text-zinc-400 hover:text-zinc-700' : cn(accent.text, 'hover:opacity-80'),
                      )}
                    >
                      <Pencil className="w-3 h-3" />
                      {answered ? 'Editar' : 'Responder'}
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-3 ml-7 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {q.type === 'textarea' || q.type === 'list' || q.type === 'multi_select' ? (
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        placeholder={q.placeholder}
                        autoFocus
                        className={cn(
                          'w-full text-[13px] rounded-xl bg-zinc-50/80 border border-zinc-200 px-3.5 py-2.5',
                          'focus:border-zinc-300 focus:outline-none focus:ring-2 transition-all',
                          accent.focus,
                        )}
                      />
                    ) : (
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={q.placeholder}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) save(q); }}
                        className={cn(
                          'w-full text-[13px] rounded-xl bg-zinc-50/80 border border-zinc-200 px-3.5 py-2.5',
                          'focus:border-zinc-300 focus:outline-none focus:ring-2 transition-all',
                          accent.focus,
                        )}
                      />
                    )}
                    {q.options && q.options.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {q.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setDraft((d) => {
                              const parts = d.split(',').map((s) => s.trim()).filter(Boolean);
                              return parts.includes(opt) ? parts.filter((p) => p !== opt).join(', ') : [...parts, opt].join(', ');
                            })}
                            className={cn(
                              'text-[11px] px-2 py-0.5 rounded-full border transition-all',
                              draft.includes(opt)
                                ? cn(accent.softBg, accent.border, accent.text, 'font-medium')
                                : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300',
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => save(q)}
                        disabled={saving || !draft.trim()}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-[12px] font-medium px-4 py-2 rounded-xl transition-all',
                          accent.bg, 'text-white hover:opacity-90 disabled:opacity-40 shadow-sm',
                        )}
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Guardar
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 text-[12px] font-medium px-3 py-2 rounded-xl bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : answered ? (
                  <pre className="mt-2 ml-7 text-[13px] text-zinc-700 leading-relaxed whitespace-pre-wrap font-sans">
                    {answerAsString(value)}
                  </pre>
                ) : (
                  <p className="mt-1 ml-7 text-[12px] text-zinc-300 italic">Sin respuesta</p>
                )}
              </div>

              {insight.status !== 'hidden' && !isEditing && (
                <div className="px-5 pb-4">
                  <SmartInsightCard
                    state={insight}
                    onNextAction={(zoneId) => zoneId && router.push(`/knowledge/${zoneId}`)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom nav */}
      <div className="mt-6 flex items-center justify-between">
        {siblingZones.prev ? (
          <button
            onClick={() => router.push(`/knowledge/${siblingZones.prev!.id}`)}
            className="inline-flex items-center gap-2 text-[13px] text-zinc-500 hover:text-zinc-800 transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            {siblingZones.prev.title}
          </button>
        ) : <span />}
        {siblingZones.next ? (
          <button
            onClick={() => router.push(`/knowledge/${siblingZones.next!.id}`)}
            className="inline-flex items-center gap-2 text-[13px] text-zinc-500 hover:text-zinc-800 transition-colors group"
          >
            {siblingZones.next.title}
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : <span />}
      </div>
    </div>
  );
}

function NavPill({
  zone,
  direction,
  allQuestions,
  onClick,
}: {
  zone: Zone;
  direction: 'prev' | 'next';
  allQuestions: Question[];
  onClick: () => void;
}) {
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent] ?? ACCENT.blue;
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full',
        'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-all',
      )}
    >
      {direction === 'prev' && <ArrowLeft className="w-3 h-3" />}
      <Icon className={cn('w-3 h-3', accent.text)} strokeWidth={1.75} />
      <span className="hidden sm:inline">{zone.title}</span>
      {direction === 'next' && <ChevronRight className="w-3 h-3" />}
    </button>
  );
}
