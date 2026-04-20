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
        className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition"
      >
        {pending ? '…' : 'Aprobar'}
      </button>
      <button
        type="button"
        onClick={() => dispatch('reject')}
        disabled={pending}
        className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-700 hover:text-zinc-900 hover:border-zinc-300 disabled:opacity-50 transition"
      >
        Rechazar
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
