// ═════════════════════════════════════════════════════════════════════════════
// PER-DOCTOR BILLING — Wave 5 PR 3
//
// Modelo: cada doctor tiene su propia suscripción Stripe (1 customer Stripe
// por doctor, 1 subscription por doctor). El owner del consultorio NO paga
// por todos — cada doctor paga lo suyo.
//
// Trial: 30 días por doctor. Si el doctor no convierte al final del trial,
// su staff.subscription_status pasa a 'unpaid' y queda en read-only/lockout.
//
// Stripe products (crear en Dashboard antes de cobrar):
//   - Esencial Doctor: $599 MXN/mes
//   - Pro Doctor:      $999 MXN/mes
//   - Ultimate Doctor: $1499 MXN/mes
//
// Env vars:
//   STRIPE_PRICE_DOCTOR_ESENCIAL=price_xxx
//   STRIPE_PRICE_DOCTOR_PRO=price_xxx
//   STRIPE_PRICE_DOCTOR_ULTIMATE=price_xxx
// ═════════════════════════════════════════════════════════════════════════════

import { getStripe } from './stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export type DoctorPlan = 'esencial' | 'pro' | 'ultimate';

const DOCTOR_PRICE_IDS: Record<DoctorPlan, string | undefined> = {
  esencial: process.env.STRIPE_PRICE_DOCTOR_ESENCIAL,
  pro: process.env.STRIPE_PRICE_DOCTOR_PRO,
  ultimate: process.env.STRIPE_PRICE_DOCTOR_ULTIMATE,
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.useatiende.ai';

export class BillingConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BillingConfigError';
  }
}

/**
 * Crea un Stripe Customer para el doctor (idempotente). Si el doctor ya
 * tiene un stripe_customer_id en su staff row, lo reutiliza. Sino, lo crea
 * y persiste.
 */
export async function ensureStripeCustomer(opts: {
  staffId: string;
  email: string;
  name: string;
  tenantId: string;
}): Promise<string> {
  const { data: staff } = await supabaseAdmin
    .from('staff')
    .select('stripe_customer_id')
    .eq('id', opts.staffId)
    .maybeSingle();

  if (staff?.stripe_customer_id) {
    return staff.stripe_customer_id as string;
  }

  const customer = await getStripe().customers.create({
    email: opts.email,
    name: opts.name,
    metadata: {
      staff_id: opts.staffId,
      tenant_id: opts.tenantId,
      type: 'per_doctor',
    },
  });

  await supabaseAdmin
    .from('staff')
    .update({ stripe_customer_id: customer.id })
    .eq('id', opts.staffId);

  return customer.id;
}

/**
 * Crea checkout session para el doctor. El callback success vuelve al
 * dashboard con `?subscription=success` y el cancel vuelve al settings/billing.
 *
 * El trial de 30 días se aplica DESDE el momento del checkout (no se cuenta
 * desde la creación del staff). Esto previene que un doctor "use" el trial
 * antes de poner tarjeta — solo arranca el countdown cuando se compromete.
 *
 * Si el doctor ya tiene una suscripción activa, retornamos la billing portal
 * URL para que la gestione (cambio de plan, cancelar, etc.).
 */
export async function createDoctorCheckout(opts: {
  staffId: string;
  email: string;
  name: string;
  tenantId: string;
  plan: DoctorPlan;
}): Promise<{ url: string; mode: 'checkout' | 'portal' }> {
  const priceId = DOCTOR_PRICE_IDS[opts.plan];
  if (!priceId) {
    throw new BillingConfigError(
      `STRIPE_PRICE_DOCTOR_${opts.plan.toUpperCase()} no está configurado. ` +
      `Crea el price en Stripe Dashboard ($${planPriceMxn(opts.plan)} MXN/mes) y ` +
      `agrégalo a Vercel env vars antes de aceptar checkout para plan ${opts.plan}.`,
    );
  }
  if (!priceId.startsWith('price_')) {
    throw new BillingConfigError(`STRIPE_PRICE_DOCTOR_${opts.plan.toUpperCase()} inválido: "${priceId}"`);
  }

  // Si ya tiene subscription activa → portal
  const { data: existing } = await supabaseAdmin
    .from('staff')
    .select('stripe_subscription_id, subscription_status')
    .eq('id', opts.staffId)
    .maybeSingle();

  if (existing?.stripe_subscription_id && existing.subscription_status === 'active') {
    const portal = await createBillingPortalSession({
      staffId: opts.staffId,
      email: opts.email,
      name: opts.name,
      tenantId: opts.tenantId,
    });
    return { url: portal, mode: 'portal' };
  }

  const customerId = await ensureStripeCustomer({
    staffId: opts.staffId,
    email: opts.email,
    name: opts.name,
    tenantId: opts.tenantId,
  });

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      // 30 días gratis ("primer mes gratis sin tarjeta NO — Stripe pide
      // tarjeta para garantizar conversión sin friction al final del trial").
      // Si querés permitir trial sin tarjeta, hay que usar el flag
      // `payment_method_collection: 'if_required'` y trial separado.
      trial_period_days: 30,
      metadata: {
        staff_id: opts.staffId,
        tenant_id: opts.tenantId,
        plan: opts.plan,
        billing_type: 'per_doctor',
      },
    },
    metadata: {
      staff_id: opts.staffId,
      tenant_id: opts.tenantId,
      plan: opts.plan,
    },
    success_url: `${APP_URL}/settings/billing?subscription=success&plan=${opts.plan}`,
    cancel_url: `${APP_URL}/settings/billing?subscription=cancelled`,
    // No requerir tarjeta durante el trial — Stripe igual la pide pero
    // sin cobro inmediato. El doctor confía más cuando NO hay cobro.
    // payment_method_collection: 'if_required', // descomenta si querés esto
  });

  if (!session.url) {
    throw new Error('Stripe no devolvió URL de checkout');
  }

  return { url: session.url, mode: 'checkout' };
}

/**
 * Crea una billing portal session para que el doctor gestione su
 * suscripción (cambio plan, cancelar, ver facturas).
 */
export async function createBillingPortalSession(opts: {
  staffId: string;
  email: string;
  name: string;
  tenantId: string;
}): Promise<string> {
  const customerId = await ensureStripeCustomer(opts);
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/settings/billing`,
  });
  return session.url;
}

function planPriceMxn(plan: DoctorPlan): number {
  return { esencial: 599, pro: 999, ultimate: 1499 }[plan];
}

// ─── Webhook handler para subscription events ────────────────────────────

/**
 * Procesa eventos de subscription para actualizar staff.plan +
 * subscription_status. El webhook handler de Stripe (api/webhook/stripe)
 * llama esta función para events con metadata.billing_type='per_doctor'.
 *
 * Eventos relevantes:
 *   - customer.subscription.created: trial empieza
 *   - customer.subscription.updated: cambió plan o status
 *   - customer.subscription.deleted: cancelada
 *   - invoice.payment_failed: past_due
 *   - invoice.payment_succeeded: vuelve a active
 */
export async function handleDoctorSubscriptionEvent(opts: {
  subscriptionId: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired';
  plan: DoctorPlan;
  staffId: string;
  trialEnd: number | null; // unix timestamp
}): Promise<void> {
  const dbStatus = mapStripeStatus(opts.status);
  const trialEndsAt = opts.trialEnd ? new Date(opts.trialEnd * 1000).toISOString() : null;

  const { error } = await supabaseAdmin
    .from('staff')
    .update({
      plan: dbStatus === 'cancelled' ? 'cancelled' : opts.plan,
      stripe_subscription_id: opts.subscriptionId,
      subscription_status: dbStatus,
      trial_ends_at: trialEndsAt,
    })
    .eq('id', opts.staffId);

  if (error) {
    logger.error('[per-doctor-billing] update staff failed', new Error(error.message), {
      staff_id: opts.staffId,
      subscription_id: opts.subscriptionId,
    });
    throw error;
  }

  logger.info('[per-doctor-billing] subscription updated', {
    staff_id: opts.staffId,
    plan: opts.plan,
    status: dbStatus,
  });
}

function mapStripeStatus(
  s: string,
): 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unpaid' {
  switch (s) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    case 'unpaid':
    case 'incomplete':
      return 'unpaid';
    default:
      return 'unpaid';
  }
}

// ─── Pricing helpers ─────────────────────────────────────────────────────

export const DOCTOR_PLAN_PRICES_MXN: Record<DoctorPlan, number> = {
  esencial: 599,
  pro: 999,
  ultimate: 1499,
};

export const DOCTOR_PLAN_FEATURES: Record<DoctorPlan, string[]> = {
  esencial: [
    'Conversaciones de WhatsApp ilimitadas',
    'Agente AI 24/7 en español natural',
    'Agenda integrada con Google Calendar',
    'Recordatorios automáticos 24h antes',
    'Knowledge base personalizable',
    'Handoff inteligente a tu recepcionista',
    'Dashboard con métricas de conversaciones',
    'Onboarding auto-deploy + soporte por email',
  ],
  pro: [
    'Todo lo del plan Esencial',
    'Marketing AI: contenido para Instagram, Facebook y blog',
    'Personal AI: briefing diario + reportes semanales',
    'Reactivación automática de pacientes inactivos (+6 meses)',
    '500 mensajes salientes para campañas',
    'Lista de espera, citas recurrentes y familiares',
    'Pagos con Stripe + Facturación CFDI',
    'Telemedicina integrada y soporte prioritario',
  ],
  ultimate: [
    'Todo lo del plan Pro',
    'Valeria: secretaria de voz AI, llamadas 24/7',
    '300 minutos de voz incluidos (luego $5 MXN/min)',
    'Multi-sucursal + analytics avanzado',
    'API completa para integraciones custom',
    'Onboarding 1:1 con especialista (2h)',
    'Account manager dedicado + soporte 24/7',
  ],
};
