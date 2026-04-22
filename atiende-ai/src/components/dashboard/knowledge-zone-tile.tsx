'use client';

import {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Zone, ZoneCompletion } from '@/lib/knowledge/zone-map';

const ICONS = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} as const satisfies Record<string, React.ComponentType<{ className?: string }>>;

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
  onClick?: () => void;
  delayClass?: string;
}

export function KnowledgeZoneTile({ zone, completion, onClick, delayClass }: KnowledgeZoneTileProps) {
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent];
  const isComplete = completion.percent >= 100 && completion.total > 0;

  const CIRCUMFERENCE = 100;
  const dashOffset = CIRCUMFERENCE - (completion.percent / 100) * CIRCUMFERENCE;

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2 px-3 py-2.5 bg-white',
        'text-left transition-all duration-200',
        'hover:bg-zinc-50/80 active:scale-[0.98]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--brand-blue))]',
        'animate-element',
        delayClass,
      )}
      {...(onClick ? { type: 'button' } : {})}
    >
      <div className="relative w-8 h-8 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90 absolute inset-0">
          <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-zinc-100" strokeWidth="4" />
          <circle
            cx="18" cy="18" r="15.9155" fill="none"
            className={cn(accent.ring, 'transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]')}
            strokeWidth="4" strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={dashOffset}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center', accent.text)}>
          {isComplete ? (
            <Check className="w-3 h-3" strokeWidth={2.5} />
          ) : (
            <Icon className="w-3 h-3" strokeWidth={1.75} />
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-zinc-800 truncate leading-tight">
          {zone.title}
        </p>
        <p className="text-[9px] text-zinc-400 tabular-nums">
          {completion.answered}/{completion.total} · {completion.percent}%
        </p>
      </div>
    </Tag>
  );
}
