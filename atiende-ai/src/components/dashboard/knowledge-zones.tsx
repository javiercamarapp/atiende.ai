'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Sparkles, Clock, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck, Check, MessageSquare, ChevronRight,
  ChevronDown, Wand2, Settings2,
} from 'lucide-react';
import { useState } from 'react';
import { PersonalityCard } from '@/components/dashboard/personality-card';
import { KnowledgeAdvanced } from '@/components/dashboard/knowledge-advanced';
import { cn } from '@/lib/utils';
import type { Question } from '@/lib/onboarding/questions';
import type { Zone, ZoneCompletion } from '@/lib/knowledge/zone-map';
import {
  getVisibleZones,
  computeZoneCompletion,
  computeOverallCompletion,
} from '@/lib/knowledge/zone-map';

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
};

const ACCENT: Record<string, { ring: string; text: string; bg: string; gradFrom: string; gradTo: string }> = {
  blue:    { ring: 'stroke-blue-500',    text: 'text-blue-600',    bg: 'bg-blue-500',    gradFrom: 'from-blue-500',    gradTo: 'to-blue-600' },
  violet:  { ring: 'stroke-violet-500',  text: 'text-violet-600',  bg: 'bg-violet-500',  gradFrom: 'from-violet-500',  gradTo: 'to-violet-600' },
  emerald: { ring: 'stroke-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-500', gradFrom: 'from-emerald-500', gradTo: 'to-emerald-600' },
  orange:  { ring: 'stroke-orange-500',  text: 'text-orange-600',  bg: 'bg-orange-500',  gradFrom: 'from-orange-500',  gradTo: 'to-orange-600' },
  amber:   { ring: 'stroke-amber-500',   text: 'text-amber-600',   bg: 'bg-amber-500',   gradFrom: 'from-amber-500',   gradTo: 'to-amber-600' },
  indigo:  { ring: 'stroke-indigo-500',  text: 'text-indigo-600',  bg: 'bg-indigo-500',  gradFrom: 'from-indigo-500',  gradTo: 'to-indigo-600' },
  rose:    { ring: 'stroke-rose-500',    text: 'text-rose-600',    bg: 'bg-rose-500',    gradFrom: 'from-rose-500',    gradTo: 'to-rose-600' },
  teal:    { ring: 'stroke-teal-500',    text: 'text-teal-600',    bg: 'bg-teal-500',    gradFrom: 'from-teal-500',    gradTo: 'to-teal-600' },
  fuchsia: { ring: 'stroke-fuchsia-500', text: 'text-fuchsia-600', bg: 'bg-fuchsia-500', gradFrom: 'from-fuchsia-500', gradTo: 'to-fuchsia-600' },
  cyan:    { ring: 'stroke-cyan-500',    text: 'text-cyan-600',    bg: 'bg-cyan-500',    gradFrom: 'from-cyan-500',    gradTo: 'to-cyan-600' },
};

export interface KnowledgeZonesProps {
  verticalQuestions: Question[];
  initialResponses: Record<string, unknown>;
  personalityInitial?: {
    tone: string; emojis: string; greeting: string;
    closing: string; phrases: string; avoid: string;
  };
  advancedProps?: {
    tenantId: string; chunks: { id: string; content: string; category: string; source: string; created_at: string }[];
    categories: string[]; initialPrompt: string; initialWelcome: string;
  };
}

export function KnowledgeZones({ verticalQuestions, initialResponses, personalityInitial, advancedProps }: KnowledgeZonesProps) {
  const visibleZones = useMemo(() => getVisibleZones(verticalQuestions), [verticalQuestions]);

  const answeredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(initialResponses)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      set.add(key);
    }
    return set;
  }, [initialResponses]);

  const overall = useMemo(
    () => computeOverallCompletion(verticalQuestions, answeredKeys),
    [verticalQuestions, answeredKeys],
  );

  const CIRC = 100;
  const heroOffset = CIRC - (overall.percent / 100) * CIRC;

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between px-6 lg:px-10 py-5 shrink-0">
        <div className="flex items-center gap-4">
          {/* Ring */}
          <div className="relative w-12 h-12 shrink-0">
            <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
              <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-zinc-200" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.9155" fill="none"
                className="stroke-[hsl(235,84%,55%)] transition-[stroke-dashoffset] duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={heroOffset}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-zinc-900 tabular-nums">
              {overall.percent}%
            </span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-900 tracking-tight">Conocimiento</h1>
            <p className="text-[13px] text-zinc-500">
              {overall.answered === overall.total
                ? 'Tu agente sabe todo lo necesario'
                : `${overall.answered} de ${overall.total} respuestas configuradas`}
            </p>
          </div>
        </div>

        <Link
          href="/knowledge/test-bot"
          className="inline-flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-xl bg-[hsl(235,84%,55%)] text-white shadow-md shadow-[hsl(235,84%,55%)]/25 hover:bg-[hsl(235,84%,48%)] hover:shadow-lg hover:shadow-[hsl(235,84%,55%)]/30 transition-all duration-200"
        >
          <MessageSquare className="w-4 h-4" />
          Probar bot
        </Link>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-6 lg:px-10 pb-6">
        {/* Zone grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visibleZones.map((zone, i) => {
            const completion = computeZoneCompletion(zone.id, verticalQuestions, answeredKeys);
            return (
              <ZoneCard
                key={zone.id}
                zone={zone}
                completion={completion}
                index={i}
              />
            );
          })}
        </div>

        {/* Personality + Advanced — collapsible sections */}
        <div className="mt-5 space-y-2">
          {personalityInitial && (
            <CollapsibleSection
              icon={<Wand2 className="w-4 h-4 text-fuchsia-500" />}
              title="Personalidad"
              subtitle="Tono, emojis, frases del bot"
            >
              <PersonalityCard initial={personalityInitial} />
            </CollapsibleSection>
          )}
          {advancedProps && (
            <CollapsibleSection
              icon={<Settings2 className="w-4 h-4 text-zinc-500" />}
              title="Opciones avanzadas"
              subtitle="Fragmentos, documentos, integraciones y prompt"
            >
              <KnowledgeAdvanced
                tenantId={advancedProps.tenantId}
                chunks={advancedProps.chunks}
                categories={advancedProps.categories}
                initialPrompt={advancedProps.initialPrompt}
                initialWelcome={advancedProps.initialWelcome}
              />
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoneCard({ zone, completion, index }: { zone: Zone; completion: ZoneCompletion; index: number }) {
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent] ?? ACCENT.blue;
  const isComplete = completion.percent >= 100 && completion.total > 0;
  const CIRC = 100;
  const dashOffset = CIRC - (completion.percent / 100) * CIRC;

  return (
    <Link
      href={`/knowledge/${zone.id}`}
      className="group relative flex items-center gap-4 rounded-2xl border border-zinc-200/70 p-4 transition-all duration-300 hover:shadow-lg hover:shadow-zinc-900/5 hover:border-zinc-300/80 hover:-translate-y-0.5 active:scale-[0.98] animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
    >
      {/* Progress ring */}
      <div className="relative w-11 h-11 shrink-0">
        <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
          <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-zinc-100" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9155" fill="none"
            className={cn(accent.ring, 'transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={dashOffset}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center', accent.text)}>
          {isComplete ? (
            <Check className="w-4 h-4" strokeWidth={2.5} />
          ) : (
            <Icon className="w-4 h-4" strokeWidth={1.75} />
          )}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-semibold text-zinc-900 truncate">{zone.title}</p>
          <ChevronRight className="w-4 h-4 text-zinc-300 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-500" />
        </div>
        <p className="text-[12px] text-zinc-500 mt-0.5 line-clamp-1">{zone.description}</p>
        {/* Mini progress bar */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]', accent.bg)}
              style={{ width: `${completion.percent}%` }}
            />
          </div>
          <span className="text-[10px] font-semibold text-zinc-400 tabular-nums shrink-0">
            {completion.answered}/{completion.total}
          </span>
        </div>
      </div>
    </Link>
  );
}

function CollapsibleSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-zinc-200/70 overflow-hidden transition-all duration-300">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50/50 transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-zinc-900">{title}</p>
          <p className="text-[12px] text-zinc-400">{subtitle}</p>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}
