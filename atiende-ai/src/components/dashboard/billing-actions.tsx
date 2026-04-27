'use client';

// ═════════════════════════════════════════════════════════════════════════════
// <BillingActions />
//
// Cliente-side button que dispara checkout o portal vía
// /api/billing/staff/checkout. El endpoint devuelve { url, mode }: si el
// doctor ya tiene sub activa, mode='portal' y la url va al billing portal de
// Stripe; sino mode='checkout' con trial de 30 días.
//
// Como el endpoint elige internamente entre checkout y portal según el
// estado actual del staff, este botón siempre POSTea con un plan válido
// (incluso para "Gestionar suscripción", mandamos el plan actual — el
// endpoint igual va a retornar portal URL).
// ═════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DoctorPlan } from '@/lib/billing/per-doctor';

type Props =
  | { mode: 'checkout'; plan: DoctorPlan }
  | { mode: 'portal'; plan?: DoctorPlan };

export function BillingActions(props: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      // Para mode='portal' mandamos un plan default (esencial) — el endpoint
      // detecta que ya hay sub activa y devuelve la URL del portal igual.
      const planToSend = props.mode === 'checkout' ? props.plan : 'esencial';
      const res = await fetch('/api/billing/staff/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planToSend }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        toast.error(json.error || 'No se pudo abrir Stripe.');
        return;
      }
      // Redirigir al checkout o portal de Stripe.
      window.location.href = json.url;
    } catch {
      toast.error('Error de red. Intentá de nuevo.');
      setLoading(false);
    }
  };

  if (props.mode === 'portal') {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Gestionar suscripción
      </button>
    );
  }

  // mode === 'checkout'
  const isPro = props.plan === 'pro';
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors ${
        isPro
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-zinc-900 text-white hover:bg-zinc-800'
      }`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        'Suscribirse'
      )}
    </button>
  );
}
