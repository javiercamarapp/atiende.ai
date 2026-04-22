'use client';

import {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Zone, ZoneCompletion } from '@/lib/knowledge/zone-map';

// Whitelist of lucide icons used by zones. Keeps the bundle lean and lets
// Tailwind's content scanner keep the accent classes below.
const ICONS = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} as const satisfies Record<string, React.ComponentType<{ className?: string }>>;

// Every accent token referenced below must appear as a full class literal in
// the ACCENT table or Tailwind will prune it in production builds.
const ACCENT: Record<Zone['accent'], { ring: string; text: string; bg: string; softBg: string }> = {
  blue:    { ring: 'stroke-blue-500',    text: 'text-blue-600',    bg: 'bg-blue-500',    softBg: 'bg-blue-50'    },
  violet:  { ring: 'stroke-violet-500',  text: 'text-violet-600',  bg: 'bg-violet-500',  softBg: 'bg-violet-50'  },
  emerald: { ring: 'stroke-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-500', softBg: 'bg-emerald-50' },
  orange:  { ring: 'stroke-orange-500',  text: 'text-orange-600',  bg: 'bg-orange-500',  softBg: 'bg-orange-50'  },
  amber:   { ring: 'stroke-amber-500',   text: 'text-amber-600',   bg: 'bg-amber-500',   softBg: 'bg-amber-50'   },
  indigo:  { ring: 'stroke-indigo-500',  text: 'text-indigo-600',  bg: 'bg-indigo-500',  softBg: 'bg-indigo-50'  },
  rose:    { ring: 'stroke-rose-500',    text: 'text-rose-600',    bg: 'bg-rose-500',    softBg: 'bg-rose-50'    },
  teal:    { ring: 'stroke-teal-500',    text: 'text-teal-600',    bg: 'bg-teal-500',    softBg: 'bg-teal-50'    },
  fuchsia: { ring: 'stroke-fuchsia-500', text: 'text-fuchsia-600', bg: 'bg-fuchsia-500', softBg: 'bg-fuchsia-50' },
  cyan:    { ring: 'stroke-cyan-500',    text: 'text-cyan-600',    bg: 'bg-cyan-500',    softBg: 'bg-cyan-50'    },
};

export interface KnowledgeZoneTileProps {
  zone: Zone;
  completion: ZoneCompletion;
  onClick: () => void;
  delayClass?: string;
}

export function KnowledgeZoneTile({ zone, completion, onClick, delayClass }: KnowledgeZoneTileProps) {
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent];
  const isComplete = completion.percent >= 100 && completion.total > 0;

  // SVG ring: circumference = 2π·r. r=16 → ≈100.53. Using 100 as a
  // round-number dash base keeps percent math clean.
  const CIRCUMFERENCE = 100;
  const dashOffset = CIRCUMFERENCE - (completion.percent / 100) * CIRCUMFERENCE;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-100 bg-white',
        'text-left transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_-10px_rgba(0,0,0,0.12)]',
        'hover:border-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-blue))]',
        'animate-element',
        delayClass,
      )}
      aria-label={`${zone.title} — ${completion.answered} de ${completion.total} respuestas`}
    >
      <div className="relative w-9 h-9 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90 absolute inset-0">
          <circle
            cx="18" cy="18" r="15.9155"
            fill="none"
            className="stroke-zinc-100"
            strokeWidth="4"
          />
          <circle
            cx="18" cy="18" r="15.9155"
            fill="none"
            className={cn(accent.ring, 'transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center', accent.text)}>
          {isComplete ? (
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
          ) : (
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-zinc-900 truncate leading-tight">
          {zone.title}
        </p>
        <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">
          {completion.answered}/{completion.total} · {completion.percent}%
        </p>
      </div>
    </button>
  );
}
