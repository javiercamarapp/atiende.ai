'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck,
  Star, Compass, Palette, Truck, Check, Loader2,
  ChevronRight, MessageSquare, Minus, Plus, CheckCircle2, HelpCircle,
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

type AccentStyle = typeof ACCENT[string];

export interface ZoneDetailViewProps {
  zone: Zone;
  questions: Question[];
  allQuestions: Question[];
  initialResponses: Record<string, unknown>;
}

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

// ─── Interactive Question Widget ─────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved';

function extractQuickOptions(q: Question): string[] {
  if (q.options?.length) return q.options;
  if (!q.placeholder) return [];
  const ph = q.placeholder;
  if (ph.includes(',')) {
    const parts = ph.split(',').map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 40);
    if (parts.length >= 2 && parts.length <= 8) return parts;
  }
  if (ph.includes('/')) {
    const parts = ph.split('/').map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 40);
    if (parts.length >= 2 && parts.length <= 5) return parts;
  }
  return [];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function QuestionWidget({
  question: q,
  value,
  accent,
  onSave,
  index,
}: {
  question: Question;
  value: unknown;
  accent: AccentStyle;
  onSave: (q: Question, val: unknown) => Promise<void>;
  index: number;
}) {
  const answered = hasValue(value);
  const [localVal, setLocalVal] = useState(answerAsString(value));
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>(undefined);
  const savedTimerRef = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => {
    setLocalVal(answerAsString(value));
  }, [value]);

  const doSave = useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    setStatus('saving');
    try {
      await onSave(q, draftToApiValue(q, raw));
      setStatus('saved');
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('idle');
    }
  }, [q, onSave]);

  function handleTextChange(val: string) {
    setLocalVal(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSave(val), 600);
  }

  function selectQuickOption(opt: string) {
    if (q.type === 'multi_select' || q.type === 'list') {
      const parts = localVal.split(',').map((s) => s.trim()).filter(Boolean);
      const next = parts.includes(opt) ? parts.filter((p) => p !== opt) : [...parts, opt];
      const joined = next.join(', ');
      setLocalVal(joined);
      doSave(joined);
    } else {
      setLocalVal(opt);
      doSave(opt);
    }
  }

  const quickOpts = extractQuickOptions(q);
  const isMulti = q.type === 'multi_select' || q.type === 'list';
  const selectedParts = isMulti ? localVal.split(',').map((s) => s.trim()).filter(Boolean) : [];

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white overflow-hidden transition-all duration-300',
        status === 'saved' ? 'border-emerald-300' : answered ? 'border-zinc-200' : 'border-dashed border-zinc-300',
        'animate-in fade-in slide-in-from-bottom-2',
      )}
      style={{ animationDelay: `${40 + index * 30}ms`, animationFillMode: 'backwards' }}
    >
      <div className="p-4">
        {/* Status + label */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300',
            status === 'saved' ? 'bg-emerald-500' :
            status === 'saving' ? cn(accent.bg, 'animate-pulse') :
            answered ? accent.bg : 'bg-zinc-200',
          )}>
            {status === 'saving' ? (
              <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
            ) : status === 'saved' ? (
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.3s" fill="freeze" />
                  <set attributeName="stroke-dasharray" to="20" />
                </path>
              </svg>
            ) : answered ? (
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            ) : (
              <span className="text-[11px] font-bold text-white">{index + 1}</span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-zinc-900 leading-snug flex-1">{q.label}</p>
          {q.help && (
            <span className="text-[10px] text-zinc-400 max-w-[180px] truncate hidden lg:inline">{q.help}</span>
          )}
        </div>

        {/* Boolean: big toggle cards */}
        {q.type === 'boolean' ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { val: 'Sí', icon: (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" className={localVal.toLowerCase() === 'sí' ? 'fill-emerald-100' : 'fill-zinc-100'} />
                  <path d="M8 12.5L11 15.5L16 9" stroke={localVal.toLowerCase() === 'sí' ? '#059669' : '#a1a1aa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )},
              { val: 'No', icon: (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" className={localVal.toLowerCase() === 'no' ? 'fill-red-100' : 'fill-zinc-100'} />
                  <path d="M9 9L15 15M15 9L9 15" stroke={localVal.toLowerCase() === 'no' ? '#dc2626' : '#a1a1aa'} strokeWidth="2" strokeLinecap="round" />
                </svg>
              )},
            ].map(({ val, icon }) => {
              const active = localVal.toLowerCase() === val.toLowerCase();
              return (
                <button
                  key={val}
                  onClick={() => { setLocalVal(val); doSave(val); }}
                  className={cn(
                    'flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] transition-all duration-200 active:scale-[0.97]',
                    active
                      ? val === 'Sí' ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-400 shadow-sm' : 'bg-red-50 text-red-700 border-2 border-red-400 shadow-sm'
                      : 'bg-zinc-50 text-zinc-500 border-2 border-transparent hover:bg-zinc-100',
                  )}
                >
                  {icon}
                  {val}
                </button>
              );
            })}
          </div>

        /* Number: slider-style stepper */
        ) : q.type === 'number' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { const n = Math.max(0, (Number(localVal) || 0) - 1); setLocalVal(String(n)); doSave(String(n)); }}
              className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-600 hover:bg-zinc-200 active:scale-95 transition-all">
              <Minus className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <input value={localVal} onChange={(e) => handleTextChange(e.target.value)} type="number" placeholder={q.placeholder}
                className={cn('w-full text-center text-[18px] font-bold rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-2.5 focus:outline-none focus:ring-2 transition-all', accent.focus)} />
            </div>
            <button onClick={() => { const n = (Number(localVal) || 0) + 1; setLocalVal(String(n)); doSave(String(n)); }}
              className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-600 hover:bg-zinc-200 active:scale-95 transition-all">
              <Plus className="w-5 h-5" />
            </button>
          </div>

        /* Quick options: A/B/C/D cards */
        ) : quickOpts.length >= 2 && !expanded ? (
          <div className="space-y-2">
            <div className={cn('grid gap-1.5', quickOpts.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')}>
              {quickOpts.slice(0, 6).map((opt, oi) => {
                const active = isMulti ? selectedParts.includes(opt) : localVal === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => selectQuickOption(opt)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-[12px] font-medium transition-all duration-200 active:scale-[0.97]',
                      active
                        ? cn(accent.softBg, accent.text, accent.border, 'border-2 shadow-sm')
                        : 'bg-zinc-50 text-zinc-700 border-2 border-transparent hover:bg-zinc-100',
                    )}
                  >
                    <span className={cn(
                      'w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0',
                      active ? cn(accent.bg, 'text-white') : 'bg-zinc-200 text-zinc-500',
                    )}>
                      {active && isMulti ? <Check className="w-3 h-3" /> : LETTERS[oi]}
                    </span>
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setExpanded(true)}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 transition pl-1"
            >
              Escribir otra respuesta...
            </button>
          </div>

        /* Textarea */
        ) : q.type === 'textarea' || q.type === 'list' ? (
          <textarea
            value={localVal}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={q.placeholder}
            rows={2}
            className={cn(
              'w-full text-[13px] rounded-xl bg-zinc-50 border border-zinc-200 px-3.5 py-2.5 resize-none',
              'focus:outline-none focus:ring-2 focus:border-transparent transition-all', accent.focus,
            )}
          />

        /* Default text input with quick suggestions */
        ) : (
          <div className="space-y-2">
            <input
              value={localVal}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={q.placeholder}
              className={cn(
                'w-full text-[13px] rounded-xl bg-zinc-50 border border-zinc-200 px-3.5 py-2.5',
                'focus:outline-none focus:ring-2 focus:border-transparent transition-all', accent.focus,
              )}
            />
            {expanded && quickOpts.length >= 2 && (
              <div className="flex flex-wrap gap-1.5 animate-in fade-in duration-150">
                {quickOpts.map((opt) => (
                  <button key={opt} onClick={() => selectQuickOption(opt)}
                    className={cn('text-[11px] px-2.5 py-1 rounded-full transition-all active:scale-95',
                      localVal === opt ? cn(accent.bg, 'text-white') : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')}>
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function ZoneDetailView({ zone, questions, allQuestions, initialResponses }: ZoneDetailViewProps) {
  const router = useRouter();
  const accent = ACCENT[zone.accent] ?? ACCENT.blue;
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;

  const [responses, setResponses] = useState<Record<string, unknown>>(initialResponses);

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

  const saveQuestion = useCallback(async (q: Question, apiValue: unknown) => {
    try {
      const res = await fetch('/api/knowledge/save-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionKey: q.key, questionLabel: q.label, answer: apiValue }),
      });
      if (!res.ok) throw new Error();
      setResponses((r) => ({ ...r, [q.key]: apiValue }));
    } catch {
      toast.error('No se pudo guardar.');
      throw new Error('save failed');
    }
  }, []);

  return (
    <div className="w-full h-[calc(100dvh-64px)] flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 lg:px-6 py-2 shrink-0">
        <button
          onClick={() => router.push('/knowledge')}
          className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-800 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Conocimiento
        </button>
        <div className="flex items-center gap-2">
          {siblingZones.prev && (
            <NavPill zone={siblingZones.prev} direction="prev" allQuestions={allQuestions}
              onClick={() => router.push(`/knowledge/${siblingZones.prev!.id}`)} />
          )}
          {siblingZones.next && (
            <NavPill zone={siblingZones.next} direction="next" allQuestions={allQuestions}
              onClick={() => router.push(`/knowledge/${siblingZones.next!.id}`)} />
          )}
          <Link
            href="/knowledge/test-bot"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-xl bg-[hsl(235,84%,55%)] text-white shadow-sm shadow-[hsl(235,84%,55%)]/25 hover:bg-[hsl(235,84%,48%)] transition-all"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Probar bot
          </Link>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left panel — hero */}
        <div className="lg:w-[340px] lg:shrink-0 overflow-y-auto p-4 lg:p-6 lg:border-r lg:border-zinc-100">
          <section className={cn(
            'rounded-3xl border border-zinc-200/60 bg-gradient-to-br overflow-hidden',
            'shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]',
            accent.gradFrom, accent.gradTo,
          )}>
            <div className="px-6 py-8 flex flex-col items-center text-center">
              <div className="relative w-20 h-20 mb-4">
                <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90 drop-shadow-sm">
                  <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-white/60" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="15.9155" fill="none"
                    className={cn(accent.ring, 'transition-[stroke-dashoffset] duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
                    strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                  />
                </svg>
                <span className={cn('absolute inset-0 flex items-center justify-center', completion.percent >= 100 ? accent.text : '')}>
                  {completion.percent >= 100 ? (
                    <Check className="w-7 h-7" strokeWidth={2} />
                  ) : (
                    <Icon className={cn('w-7 h-7', accent.text)} strokeWidth={1.5} />
                  )}
                </span>
              </div>
              <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">{zone.title}</h1>
              <p className="text-[13px] text-zinc-500 mt-1 max-w-xs">{zone.description}</p>
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
        </div>

        {/* Right panel — questions */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="space-y-2.5 max-w-2xl">
            {questions.map((q, i) => (
              <QuestionWidget
                key={q.key}
                question={q}
                value={responses[q.key]}
                accent={accent}
                onSave={saveQuestion}
                index={i}
              />
            ))}
          </div>

          {/* Bottom nav */}
          <div className="mt-6 flex items-center justify-between max-w-2xl pb-4">
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
      </div>
    </div>
  );
}

function NavPill({
  zone, direction, allQuestions, onClick,
}: {
  zone: Zone; direction: 'prev' | 'next'; allQuestions: Question[]; onClick: () => void;
}) {
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent] ?? ACCENT.blue;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-all"
    >
      {direction === 'prev' && <ArrowLeft className="w-3 h-3" />}
      <Icon className={cn('w-3 h-3', accent.text)} strokeWidth={1.75} />
      <span className="hidden sm:inline">{zone.title}</span>
      {direction === 'next' && <ChevronRight className="w-3 h-3" />}
    </button>
  );
}
