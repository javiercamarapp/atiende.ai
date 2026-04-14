'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AnomalyBanner — banner dismissible en top del dashboard con detecciones
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { Anomaly } from '@/lib/intelligence/anomaly-detector';

const SEVERITY_STYLE: Record<
  Anomaly['severity'] | 'positive',
  { bg: string; border: string; text: string }
> = {
  info: { bg: 'bg-sky-400/5', border: 'border-sky-400/20', text: 'text-sky-200' },
  warning: { bg: 'bg-amber-400/10', border: 'border-amber-400/25', text: 'text-amber-200' },
  critical: { bg: 'bg-red-400/10', border: 'border-red-400/30', text: 'text-red-200' },
  positive: { bg: 'bg-emerald-400/10', border: 'border-emerald-400/25', text: 'text-emerald-200' },
};

export function AnomalyBanner({ anomalies }: { anomalies: Anomaly[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = anomalies.filter((a) => !dismissed.has(a.metric));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 animate-element">
      {visible.map((a) => {
        const key = a.type === 'positive' ? 'positive' : a.severity;
        const s = SEVERITY_STYLE[key];
        return (
          <div
            key={a.metric}
            className={`flex items-center justify-between gap-4 rounded-lg border ${s.border} ${s.bg} px-4 py-2.5`}
          >
            <p className={`text-sm ${s.text} flex-1`}>{a.message}</p>
            <button
              type="button"
              aria-label="Descartar"
              onClick={() => setDismissed((prev) => new Set(prev).add(a.metric))}
              className={`shrink-0 ${s.text} opacity-60 hover:opacity-100 transition`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
