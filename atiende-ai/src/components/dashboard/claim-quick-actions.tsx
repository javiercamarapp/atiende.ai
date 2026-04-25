'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, X, Send, Hourglass } from 'lucide-react';

type Status = 'pending_submission' | 'submitted' | 'in_review' | 'approved' | 'denied' | 'partial' | 'paid';

interface Props {
  claimId: string;
  status: Status;
}

export function ClaimQuickActions({ claimId, status }: Props) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  void _pending;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = async (newStatus: Status, extra?: Record<string, unknown>) => {
    setBusy(newStatus);
    setError(null);
    try {
      const res = await fetch(`/api/insurance-claims/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...(extra || {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || data.error || 'Error');
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  };

  // Quick actions disponibles según el estado actual del claim
  const canMarkSubmitted = status === 'pending_submission';
  const canMarkInReview = status === 'submitted';
  const canMarkApproved = status === 'submitted' || status === 'in_review';
  const canMarkPaid = status === 'approved' || status === 'partial';
  const canMarkDenied = status === 'submitted' || status === 'in_review';

  const buttonClass =
    'text-[11px] px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 disabled:opacity-50 transition flex items-center gap-1';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canMarkSubmitted && (
        <button onClick={() => update('submitted')} disabled={!!busy} className={buttonClass}>
          <Send className="w-3 h-3" /> {busy === 'submitted' ? 'Marcando…' : 'Marcar enviado'}
        </button>
      )}
      {canMarkInReview && (
        <button onClick={() => update('in_review')} disabled={!!busy} className={buttonClass}>
          <Hourglass className="w-3 h-3" /> {busy === 'in_review' ? 'Marcando…' : 'En revisión'}
        </button>
      )}
      {canMarkApproved && (
        <button onClick={() => update('approved')} disabled={!!busy} className={buttonClass}>
          <CheckCircle2 className="w-3 h-3" /> {busy === 'approved' ? 'Marcando…' : 'Aprobado'}
        </button>
      )}
      {canMarkPaid && (
        <button
          onClick={() => {
            const amt = window.prompt('Monto pagado por la aseguradora (MXN, sin signo):');
            if (!amt) return;
            const n = Number(amt);
            if (!Number.isFinite(n) || n < 0) { window.alert('Monto inválido'); return; }
            update('paid', { amount_paid_mxn: n });
          }}
          disabled={!!busy}
          className={`${buttonClass} bg-emerald-50 border-emerald-200 text-emerald-800 hover:border-emerald-300`}
        >
          <CheckCircle2 className="w-3 h-3" /> {busy === 'paid' ? 'Guardando…' : 'Pagado'}
        </button>
      )}
      {canMarkDenied && (
        <button
          onClick={() => {
            const reason = window.prompt('Motivo de rechazo (lo verá el dueño en el panel):');
            if (!reason) return;
            update('denied', { denial_reason: reason });
          }}
          disabled={!!busy}
          className={`${buttonClass} bg-red-50 border-red-200 text-red-800 hover:border-red-300`}
        >
          <X className="w-3 h-3" /> {busy === 'denied' ? 'Guardando…' : 'Rechazado'}
        </button>
      )}
      {error && <span className="text-[11px] text-red-700">⚠ {error}</span>}
    </div>
  );
}
