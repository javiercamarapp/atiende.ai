'use client';

import { CheckCircle2, TrendingUp, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ZoneId } from '@/lib/knowledge/zone-map';

export interface SmartInsight {
  validation: string;
  benchmark: string;
  nextAction?: {
    label: string;
    zoneId?: ZoneId;
  };
}

export interface SmartInsightCardProps {
  state:
    | { status: 'loading' }
    | { status: 'ready'; insight: SmartInsight; cached?: boolean; degraded?: boolean }
    | { status: 'hidden' };
  onNextAction?: (zoneId: ZoneId | undefined) => void;
}

// Subtle card shown under an answered question: green validation line,
// benchmark line with trend icon, optional next-action button. Kept static
// in width to avoid layout jumps while the LLM call resolves.
export function SmartInsightCard({ state, onNextAction }: SmartInsightCardProps) {
  if (state.status === 'hidden') return null;

  if (state.status === 'loading') {
    return (
      <div className="rounded-2xl border border-zinc-100 bg-white p-4 flex items-center gap-3 animate-element animate-delay-100">
        <Loader2 className="w-4 h-4 text-[hsl(var(--brand-blue))] animate-spin" />
        <p className="text-xs text-zinc-500">Analizando tu respuesta con el sector…</p>
      </div>
    );
  }

  const { insight, degraded } = state;

  return (
    <div
      className={cn(
        'rounded-2xl border border-zinc-100 bg-gradient-to-br from-white to-zinc-50 p-4 space-y-3',
        'animate-element animate-delay-100',
      )}
    >
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" strokeWidth={2} />
        <p className="text-[13px] text-zinc-800 leading-relaxed">{insight.validation}</p>
      </div>

      <div className="flex items-start gap-2.5">
        <TrendingUp className="w-4 h-4 mt-0.5 text-[hsl(var(--brand-blue))] shrink-0" strokeWidth={1.75} />
        <p className="text-[13px] text-zinc-600 leading-relaxed">{insight.benchmark}</p>
      </div>

      {insight.nextAction && (
        <div className="pt-1">
          <button
            onClick={() => onNextAction?.(insight.nextAction?.zoneId)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] hover:bg-[hsl(var(--brand-blue))] hover:text-white transition"
          >
            {insight.nextAction.label}
            <ArrowRight className="w-3 h-3" strokeWidth={2} />
          </button>
        </div>
      )}

      {degraded && (
        <p className="text-[10.5px] text-zinc-400">Benchmark no disponible ahora mismo. Tu respuesta sí se guardó.</p>
      )}
    </div>
  );
}
