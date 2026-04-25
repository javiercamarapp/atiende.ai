'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SyncReviewsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onClick = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch('/api/tenants/google-reviews/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text: data.message || data.detail || `Error ${res.status}`,
        });
        return;
      }
      setMsg({
        kind: 'ok',
        text: `${data.reviews_synced} reseña${data.reviews_synced === 1 ? '' : 's'} sincronizada${data.reviews_synced === 1 ? '' : 's'}`,
      });
      // Refrescá los datos del page
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setRunning(false);
    }
  };

  const busy = running || pending;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={busy}
        className="px-3 h-8 bg-[hsl(var(--brand-blue))] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-60 transition"
      >
        {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
      </button>
      {msg && (
        <span
          className={`text-[12px] ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {msg.kind === 'ok' ? '✓' : '⚠'} {msg.text}
        </span>
      )}
    </div>
  );
}
