'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FaqPromote — botón "Agregar al knowledge base"
// ─────────────────────────────────────────────────────────────────────────────

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  tenantId: string;
  question: string;
  answer: string;
}

export function FaqPromote({ tenantId, question, answer }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  async function promote() {
    setState('idle');
    setMsg(null);
    try {
      const r = await fetch('/api/admin/faq-gaps/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, question, answer }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      setState('done');
      startTransition(() => router.refresh());
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  if (state === 'done') {
    return <span className="text-xs text-emerald-300">Agregado al knowledge base ✓</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={promote}
        disabled={pending}
        className="px-3 py-1.5 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-xs font-medium text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-50 transition"
      >
        {pending ? '…' : 'Agregar al KB'}
      </button>
      {state === 'error' && msg && <span className="text-xs text-red-300">{msg}</span>}
    </div>
  );
}
