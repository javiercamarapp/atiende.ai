'use client';

import {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { Question } from '@/lib/onboarding/questions';
import type { Zone, ZoneId } from '@/lib/knowledge/zone-map';
import { KnowledgeQuizFlow } from '@/components/dashboard/knowledge-quiz-flow';
import { useMediaQuery } from '@/hooks/use-media-query';

const ICONS = {
  Clock, Sparkles, Users, MapPin, CreditCard, ShieldCheck, Star,
  Compass, Palette, Truck,
} as const satisfies Record<string, React.ComponentType<{ className?: string }>>;

const ACCENT: Record<Zone['accent'], { text: string; softBg: string }> = {
  blue:    { text: 'text-blue-600',    softBg: 'bg-blue-50'    },
  violet:  { text: 'text-violet-600',  softBg: 'bg-violet-50'  },
  emerald: { text: 'text-emerald-600', softBg: 'bg-emerald-50' },
  orange:  { text: 'text-orange-600',  softBg: 'bg-orange-50'  },
  amber:   { text: 'text-amber-600',   softBg: 'bg-amber-50'   },
  indigo:  { text: 'text-indigo-600',  softBg: 'bg-indigo-50'  },
  rose:    { text: 'text-rose-600',    softBg: 'bg-rose-50'    },
  teal:    { text: 'text-teal-600',    softBg: 'bg-teal-50'    },
  fuchsia: { text: 'text-fuchsia-600', softBg: 'bg-fuchsia-50' },
  cyan:    { text: 'text-cyan-600',    softBg: 'bg-cyan-50'    },
};

export interface KnowledgeZoneSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: Zone | null;
  questions: Question[];
  responses: Record<string, unknown>;
  onAnswered: (questionKey: string, value: unknown) => void;
  onJumpZone?: (zoneId: ZoneId) => void;
}

// Side-sheet on desktop (≥640px), bottom-sheet on mobile. Keeps the zone
// tiles visible behind a backdrop so the user never loses their place.
export function KnowledgeZoneSheet({
  open, onOpenChange, zone, questions, responses, onAnswered, onJumpZone,
}: KnowledgeZoneSheetProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');
  const side: 'bottom' | 'right' = isMobile ? 'bottom' : 'right';

  if (!zone) return null;
  const Icon = ICONS[zone.icon as keyof typeof ICONS] ?? Sparkles;
  const accent = ACCENT[zone.accent];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          'p-0 overflow-hidden flex flex-col bg-white',
          isMobile
            ? 'h-[92svh] rounded-t-3xl sm:max-w-none'
            : 'w-full sm:max-w-xl',
        )}
      >
        <div className="px-6 pt-6 pb-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <span className={cn('inline-flex w-11 h-11 rounded-full items-center justify-center', accent.softBg, accent.text)}>
              <Icon className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 pr-10">
              <h2 className="text-base font-semibold text-zinc-900 truncate">{zone.title}</h2>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{zone.description}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <KnowledgeQuizFlow
            zone={zone}
            questions={questions}
            initialResponses={responses}
            onAnswered={onAnswered}
            onJumpZone={onJumpZone}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
