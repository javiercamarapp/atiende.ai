'use client';

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Question } from '@/lib/onboarding/questions';
import {
  ZONES,
  type ZoneId,
  getVisibleZones,
  getQuestionsForZone,
  computeZoneCompletion,
  computeOverallCompletion,
} from '@/lib/knowledge/zone-map';
import { KnowledgeZoneTile } from '@/components/dashboard/knowledge-zone-tile';
import { KnowledgeZoneSheet } from '@/components/dashboard/knowledge-zone-sheet';

// Tailwind-safe stagger ladder. One class per tile index; extras wrap back
// so the grid always animates in sequence, never all at once.
const DELAY_CLASSES = [
  'animate-delay-100', 'animate-delay-200', 'animate-delay-300', 'animate-delay-400',
  'animate-delay-500', 'animate-delay-600', 'animate-delay-700', 'animate-delay-800',
  'animate-delay-900', 'animate-delay-1000',
];

export interface KnowledgeZonesProps {
  verticalQuestions: Question[];
  initialResponses: Record<string, unknown>;
}

// Hero section of the knowledge page: overall completion ring + grid of
// zone tiles. Clicking a tile opens a side/bottom sheet that hosts the
// quiz flow for that zone. Answers mutate local `responses` state so the
// rings re-animate to their new percentages without a page reload.
export function KnowledgeZones({ verticalQuestions, initialResponses }: KnowledgeZonesProps) {
  const [responses, setResponses] = useState<Record<string, unknown>>(initialResponses);
  const [openZoneId, setOpenZoneId] = useState<ZoneId | null>(null);

  const visibleZones = useMemo(() => getVisibleZones(verticalQuestions), [verticalQuestions]);

  const answeredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(responses)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      set.add(key);
    }
    return set;
  }, [responses]);

  const overall = useMemo(
    () => computeOverallCompletion(verticalQuestions, answeredKeys),
    [verticalQuestions, answeredKeys],
  );

  const handleAnswered = (questionKey: string, value: unknown) => {
    setResponses((r) => ({ ...r, [questionKey]: value }));
  };

  const openZone = openZoneId ? ZONES.find((z) => z.id === openZoneId) ?? null : null;
  const openZoneQuestions = openZone ? getQuestionsForZone(openZone.id, verticalQuestions) : [];

  // SVG ring on the hero — same math as the tile ring (circumference 100).
  const HERO_CIRC = 100;
  const heroOffset = HERO_CIRC - (overall.percent / 100) * HERO_CIRC;

  return (
    <div className="space-y-3">
      <section className="rounded-[20px] bg-gradient-to-br from-white via-white to-[hsl(var(--brand-blue-soft))] border border-zinc-100 p-4 animate-element animate-delay-100">
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
              <circle
                cx="18" cy="18" r="15.9155"
                fill="none"
                className="stroke-zinc-100"
                strokeWidth="2.5"
              />
              <circle
                cx="18" cy="18" r="15.9155"
                fill="none"
                className="stroke-[hsl(var(--brand-blue))] transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={HERO_CIRC}
                strokeDashoffset={heroOffset}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-zinc-900 tabular-nums kpi-number">
              {overall.percent}%
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-[hsl(var(--brand-blue))]" strokeWidth={1.75} />
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--brand-blue))] font-semibold">
                Conocimiento del agente
              </span>
            </div>
            <p className="text-[15px] font-semibold text-zinc-900 leading-tight mt-0.5">
              {overall.answered === overall.total
                ? 'Tu agente ya sabe todo'
                : `${overall.answered} de ${overall.total} respuestas`}
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Elige una zona para seguir entrenándolo.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {visibleZones.map((zone, i) => {
          const completion = computeZoneCompletion(zone.id, verticalQuestions, answeredKeys);
          return (
            <KnowledgeZoneTile
              key={zone.id}
              zone={zone}
              completion={completion}
              onClick={() => setOpenZoneId(zone.id)}
              delayClass={DELAY_CLASSES[i % DELAY_CLASSES.length]}
            />
          );
        })}
      </section>

      <KnowledgeZoneSheet
        open={openZoneId !== null}
        onOpenChange={(next) => {
          if (!next) setOpenZoneId(null);
        }}
        zone={openZone}
        questions={openZoneQuestions}
        responses={responses}
        onAnswered={handleAnswered}
        onJumpZone={(zoneId) => setOpenZoneId(zoneId)}
      />
    </div>
  );
}
