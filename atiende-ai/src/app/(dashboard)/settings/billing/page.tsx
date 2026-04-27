// ═════════════════════════════════════════════════════════════════════════════
// /settings/billing
//
// Página per-doctor billing. Diseño full-width minimalista con animaciones
// del software (animate-element + brand-blue). Todo entra en un viewport
// estándar sin scroll vertical.
// ═════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { Check, Sparkles } from 'lucide-react';
import {
  getCurrentStaff,
  isInTrial,
  trialDaysLeft,
} from '@/lib/auth/current-staff';
import {
  DOCTOR_PLAN_PRICES_MXN,
  DOCTOR_PLAN_FEATURES,
  type DoctorPlan,
} from '@/lib/billing/per-doctor';
import { BillingActions } from '@/components/dashboard/billing-actions';

const PLAN_LABEL: Record<DoctorPlan, string> = {
  esencial: 'Esencial',
  pro: 'Pro',
  ultimate: 'Ultimate',
};

const PLAN_TAGLINE: Record<DoctorPlan, string> = {
  esencial: 'Ideal para empezar',
  pro: 'Para consultorios que ya escalaron',
  ultimate: 'Con Valeria, tu secretaria de voz AI',
};

export default async function BillingPage() {
  const me = await getCurrentStaff();
  if (!me) {
    redirect('/login');
  }

  if (!me.isBillable) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="max-w-xl text-center animate-element">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-3">
            Facturación
          </h1>
          <div className="bg-[hsl(var(--brand-blue-soft))] ring-1 ring-[hsl(var(--brand-blue)/0.2)] rounded-2xl p-6">
            <p className="text-sm text-zinc-700">
              Tu rol ({me.role}) no requiere suscripción individual. Solo los
              doctores tienen su propia cuenta de Stripe — el dueño del consultorio
              puede ver el estado de cada uno desde{' '}
              <a
                href="/settings/team"
                className="underline font-medium text-[hsl(var(--brand-blue))]"
              >
                Equipo
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const inTrial = isInTrial(me);
  const daysLeft = trialDaysLeft(me);
  const hasActiveSub =
    me.subscriptionStatus === 'active' ||
    me.subscriptionStatus === 'trialing' ||
    me.subscriptionStatus === 'past_due';

  const plans: DoctorPlan[] = ['esencial', 'pro', 'ultimate'];

  return (
    <div className="h-full flex flex-col px-6 py-6 overflow-hidden">
      {/* Header */}
      <header className="animate-element flex items-end justify-between gap-6 pb-5 border-b border-zinc-100">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Tu plan y facturación
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cada doctor del consultorio paga su propia suscripción. El plan
            Esencial incluye 30 días de prueba gratis.
          </p>
        </div>

        {hasActiveSub && (
          <div className="flex items-center gap-4 animate-element animate-delay-100">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                Plan actual
              </div>
              <div className="text-base font-semibold text-zinc-900">
                {me.plan
                  ? me.plan.charAt(0).toUpperCase() + me.plan.slice(1)
                  : '—'}
              </div>
              {inTrial && (
                <div className="text-xs text-[hsl(var(--brand-blue))] font-medium mt-0.5">
                  Trial: {daysLeft} {daysLeft === 1 ? 'día' : 'días'} restantes
                </div>
              )}
              {me.subscriptionStatus === 'past_due' && (
                <div className="text-xs text-orange-600 font-medium mt-0.5">
                  Pago pendiente — actualizá tu tarjeta
                </div>
              )}
            </div>
            <BillingActions mode="portal" />
          </div>
        )}
      </header>

      {/* Cards — 3 columnas iguales, llenan el alto disponible */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 min-h-0">
        {plans.map((plan, idx) => {
          const isCurrent = me.plan === plan && hasActiveSub;
          const isPopular = plan === 'pro';
          return (
            <div
              key={plan}
              className={`group relative bg-white rounded-2xl flex flex-col overflow-hidden transition-all duration-300 animate-element ${
                idx === 0
                  ? 'animate-delay-200'
                  : idx === 1
                    ? 'animate-delay-300'
                    : 'animate-delay-400'
              } ${
                isPopular
                  ? 'ring-2 ring-[hsl(var(--brand-blue))] shadow-lg shadow-[hsl(var(--brand-blue)/0.15)] hover:shadow-xl hover:shadow-[hsl(var(--brand-blue)/0.25)]'
                  : 'ring-1 ring-zinc-200 hover:ring-[hsl(var(--brand-blue)/0.4)] hover:shadow-md'
              } hover:-translate-y-0.5`}
            >
              {isPopular && (
                <div className="absolute top-0 right-0 bg-[hsl(var(--brand-blue))] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-2xl flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Más popular
                </div>
              )}

              <div className="p-5 pb-3">
                <h3 className="text-lg font-semibold text-zinc-900">
                  {PLAN_LABEL[plan]}
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {PLAN_TAGLINE[plan]}
                </p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-zinc-900">
                    ${DOCTOR_PLAN_PRICES_MXN[plan]}
                  </span>
                  <span className="text-xs text-zinc-500">MXN/mes</span>
                </div>
                {plan === 'esencial' ? (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] text-[11px] font-semibold">
                    Primer mes gratis · 30 días de prueba
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    Cobro desde el primer mes
                  </div>
                )}
              </div>

              <div className="flex-1 px-5 overflow-y-auto">
                <ul className="space-y-2 text-[13px] text-zinc-700">
                  {DOCTOR_PLAN_FEATURES[plan].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          isPopular
                            ? 'text-[hsl(var(--brand-blue))]'
                            : 'text-zinc-700'
                        }`}
                      />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-5 pt-4">
                {isCurrent ? (
                  <div className="w-full text-center py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-medium">
                    Tu plan actual
                  </div>
                ) : (
                  <BillingActions mode="checkout" plan={plan} popular={isPopular} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-400 text-center mt-3 animate-element animate-delay-500">
        Pagos procesados por Stripe · Cancelá cuando quieras desde el portal de
        facturación · Facturas CFDI disponibles en Pro y Ultimate
      </p>
    </div>
  );
}
