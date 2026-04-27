// ═════════════════════════════════════════════════════════════════════════════
// /settings/billing
//
// Página per-doctor billing. Cada doctor logueado ve:
//   - Si tiene suscripción activa o trial → estado actual + botón "Gestionar
//     suscripción" (abre Stripe billing portal vía /api/billing/staff/checkout
//     que retorna mode='portal' cuando ya hay sub).
//   - Si NO tiene suscripción → 3 cards con planes (Esencial / Pro / Ultimate)
//     y botón "Suscribirse" que dispara checkout (también vía
//     /api/billing/staff/checkout con un plan elegido).
//
// Si el user no es billable (ej: recepcionista, admin), mostramos mensaje
// informativo de que su rol no requiere suscripción individual.
// ═════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
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

export default async function BillingPage() {
  const me = await getCurrentStaff();
  if (!me) {
    redirect('/login');
  }

  if (!me.isBillable) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-zinc-900 mb-2">
          Facturación
        </h1>
        <div className="bg-blue-50 ring-1 ring-blue-200 rounded-2xl p-6 mt-6">
          <p className="text-sm text-blue-900">
            Tu rol ({me.role}) no requiere suscripción individual. Solo los
            doctores tienen su propia cuenta de Stripe — el dueño del consultorio
            puede ver el estado de cada uno desde{' '}
            <a href="/settings/team" className="underline font-medium">
              Equipo
            </a>
            .
          </p>
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
  const PLAN_LABEL: Record<DoctorPlan, string> = {
    esencial: 'Esencial',
    pro: 'Pro',
    ultimate: 'Ultimate',
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Facturación</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Tu suscripción individual. Cada doctor del consultorio paga su propio
          plan — el dueño no paga por todos.
        </p>
      </div>

      {hasActiveSub ? (
        <div className="bg-white rounded-2xl ring-1 ring-zinc-200 p-6 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1">
              Plan actual
            </div>
            <div className="text-2xl font-semibold text-zinc-900">
              {me.plan ? me.plan.charAt(0).toUpperCase() + me.plan.slice(1) : '—'}
            </div>
            {inTrial && (
              <div className="text-sm text-blue-700 mt-2 font-medium">
                Trial: {daysLeft} {daysLeft === 1 ? 'día' : 'días'} restantes
              </div>
            )}
            {me.subscriptionStatus === 'past_due' && (
              <div className="text-sm text-orange-700 mt-2 font-medium">
                ⚠️ Tu último pago falló. Actualizá tu tarjeta para no perder acceso.
              </div>
            )}
          </div>
          <BillingActions mode="portal" />
        </div>
      ) : (
        <div className="bg-amber-50 ring-1 ring-amber-200 rounded-2xl p-4">
          <p className="text-sm text-amber-900">
            No tenés una suscripción activa. Elegí un plan abajo — el primer mes
            es gratis y solo se te cobra después del trial.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = me.plan === plan && hasActiveSub;
          return (
            <div
              key={plan}
              className={`bg-white rounded-2xl ring-1 p-6 flex flex-col ${
                plan === 'pro'
                  ? 'ring-blue-300 ring-2 shadow-md'
                  : 'ring-zinc-200'
              }`}
            >
              {plan === 'pro' && (
                <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
                  Más popular
                </div>
              )}
              <h3 className="text-lg font-semibold text-zinc-900">
                {PLAN_LABEL[plan]}
              </h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-bold text-zinc-900">
                  ${DOCTOR_PLAN_PRICES_MXN[plan]}
                </span>
                <span className="text-sm text-zinc-500"> MXN/mes</span>
              </div>
              <ul className="space-y-2 text-sm text-zinc-700 flex-1 mb-6">
                {DOCTOR_PLAN_FEATURES[plan].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="w-full text-center py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-medium">
                  Tu plan actual
                </div>
              ) : (
                <BillingActions mode="checkout" plan={plan} />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-400 text-center">
        Pagos procesados por Stripe. Cancelá cuando quieras desde el portal de
        facturación. Facturas CFDI disponibles en el plan Pro y Ultimate.
      </p>
    </div>
  );
}
