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
  | { mode: 'checkout'; plan: DoctorPlan; popular?: boolean }
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[hsl(var(--brand-blue)/0.3)] text-sm font-medium text-[hsl(var(--brand-blue))] bg-white hover:bg-[hsl(var(--brand-blue-soft))] hover:border-[hsl(var(--brand-blue))] disabled:opacity-50 transition-all duration-200"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Gestionar suscripción
      </button>
    );
  }

  // mode === 'checkout' — siempre azul brand. El plan "popular" (pro) tiene
  // un glow extra para destacarlo del resto.
  const popular = props.popular;
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-[hsl(var(--brand-blue))] hover:bg-[hsl(var(--brand-blue)/0.9)] disabled:opacity-50 transition-all duration-200 ${
        popular
          ? 'shadow-md shadow-[hsl(var(--brand-blue)/0.3)] hover:shadow-lg hover:shadow-[hsl(var(--brand-blue)/0.4)] hover:-translate-y-0.5'
          : 'hover:shadow-md hover:shadow-[hsl(var(--brand-blue)/0.2)]'
      }`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Suscribirse'}
    </button>
  );
}
