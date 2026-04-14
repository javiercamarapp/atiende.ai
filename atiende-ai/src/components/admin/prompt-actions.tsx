'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PromptActions — botones client-side para approve/reject
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function PromptActions({ promptId }: { promptId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function dispatch(action: 'approve' | 'reject') {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/prompts/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promptId }),
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => dispatch('approve')}
        disabled={pending}
        className="px-3 py-1.5 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-xs font-medium text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-50 transition"
      >
        {pending ? '…' : 'Aprobar'}
      </button>
      <button
        type="button"
        onClick={() => dispatch('reject')}
        disabled={pending}
        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white hover:border-white/20 disabled:opacity-50 transition"
      >
        Rechazar
      </button>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}
