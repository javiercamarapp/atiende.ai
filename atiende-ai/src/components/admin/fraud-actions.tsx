'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FraudActions — transiciones de status (open → investigating → resolved)
// ─────────────────────────────────────────────────────────────────────────────

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

type Status = 'investigating' | 'resolved' | 'false_positive';

export function FraudActions({ alertId, current }: { alertId: string; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(next: Status) {
    setErr(null);
    try {
      const r = await fetch('/api/admin/fraud/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: alertId, status: next }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {current === 'open' && (
        <button
          type="button"
          onClick={() => setStatus('investigating')}
          disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition"
        >
          Investigando
        </button>
      )}
      {current !== 'resolved' && (
        <button
          type="button"
          onClick={() => setStatus('resolved')}
          disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition"
        >
          Resuelto
        </button>
      )}
      {current !== 'false_positive' && (
        <button
          type="button"
          onClick={() => setStatus('false_positive')}
          disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-700 hover:text-zinc-900 hover:border-zinc-300 disabled:opacity-50 transition"
        >
          Falso positivo
        </button>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
