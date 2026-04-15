import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  _stripe = new Stripe(key, {
    apiVersion: '2024-12-18.acacia' as string & Stripe.LatestApiVersion,
  });
  return _stripe;
}

// Stripe price IDs por plan.
// PREFERIDO: leer de env vars (STRIPE_PRICE_BASIC, STRIPE_PRICE_PREMIUM)
// para poder rotar precios sin redeployar. Fallback legacy a los placeholders
// originales para que los tests/dev sigan funcionando.
//
// Planes actuales (2026-04):
//   - basic   ($599 MXN)   WhatsApp Básico, sin voz
//   - pro     ($999 MXN)   Legacy — mantener solo para tenants existentes
//   - premium ($1,499 MXN) WhatsApp + Voz con 300 min incluidos + $5 MXN/min overage
const PLAN_PRICES: Record<string, string> = {
  basic: process.env.STRIPE_PRICE_BASIC || 'price_basic_599_mxn',
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_999_mxn',
  premium: process.env.STRIPE_PRICE_PREMIUM || 'price_premium_1499_mxn',
};

// Price metered para minutos de voz excedentes ($5 MXN/min, agregación SUM)
const VOICE_OVERAGE_PRICE_ID = process.env.STRIPE_VOICE_OVERAGE_PRICE_ID ?? '';

export async function createCheckoutSession(tenantId: string, email: string, plan: string) {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: PLAN_PRICES[plan], quantity: 1 },
  ];
  // Premium incluye el item metered de voice overage (cantidad 0 al inicio —
  // Stripe agrega los usageRecords reportados por el cron mensual).
  // AUDIT-R9 MED: si premium y NO hay VOICE_OVERAGE_PRICE_ID configurado,
  // ALERTAR al equipo — el tenant tendría plan voz pero NO se le podrá
  // cobrar overage. Lanzamos error para forzar fix antes de cobrar premium.
  if (plan === 'premium') {
    if (!VOICE_OVERAGE_PRICE_ID) {
      throw new Error(
        'STRIPE_VOICE_OVERAGE_PRICE_ID no está configurado. ' +
        'Crea el producto "Minutos de Voz Adicionales" ($5 MXN, metered, SUM) ' +
        'en Stripe Dashboard y ponlo en Vercel env antes de aceptar checkouts premium.',
      );
    }
    lineItems.push({ price: VOICE_OVERAGE_PRICE_ID });
  }

  return getStripe().checkout.sessions.create({
    customer_email: email,
    mode: 'subscription',
    line_items: lineItems,
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?cancelled=true`,
    metadata: { tenant_id: tenantId, plan },
    currency: 'mxn',
    allow_promotion_codes: true,
  });
}

export async function createPortalSession(customerId: string) {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });
}

/**
 * Reporta los minutos de overage de voz a Stripe como usage record.
 *
 * Se usa desde el cron mensual (src/app/api/cron/billing-overage/route.ts)
 * el primer día del mes para cerrar el ciclo del mes anterior.
 *
 * Stripe agrega los usageRecords al item metered; al generarse la factura
 * del siguiente ciclo, el overage aparece como línea adicional:
 *   "Minutos de Voz Adicionales × 47 = $235 MXN"
 *
 * action='set' (no 'increment') porque acumulamos nosotros en Postgres y
 * Stripe solo necesita el total final — evita doble-conteo si el cron
 * se ejecuta más de una vez.
 */
export async function reportVoiceOverageToStripe(
  subscriptionItemId: string,
  overageMinutes: number,
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  if (!subscriptionItemId || overageMinutes <= 0) {
    return { success: true };
  }

  // AUDIT-R8 MEDIO: retry con backoff exponencial sobre 429 / 5xx.
  // Stripe rate-limit es 100 r/s en write — improbable saturarlo, pero un
  // 5xx transitorio del provider sin retry = pérdida del cobro del mes.
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { success: false, error: 'STRIPE_SECRET_KEY missing' };

  const params = new URLSearchParams({
    quantity: String(Math.ceil(overageMinutes)),
    timestamp: String(Math.floor(Date.now() / 1000)),
    action: 'set',
  });

  const url = `https://api.stripe.com/v1/subscription_items/${subscriptionItemId}/usage_records`;
  const maxAttempts = 4;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Idempotency key — Stripe deduplica internamente si reintentamos
          // dentro de 24h con la misma key. Garantía contra doble-cobro.
          'Idempotency-Key': `voice-overage:${subscriptionItemId}:${new Date().toISOString().substring(0, 7)}`,
        },
        body: params.toString(),
      });

      // AUDIT R12 BUG-004: validar que el JSON tenga `id` (= usage record
      // creado). Si Stripe devuelve 200 pero response malformado (network
      // proxy / cache), retornamos failure para que el cron marque el row
      // como NO billed y reintente el próximo run en vez de dar por válido
      // un cobro potencialmente fantasma.
      if (res.ok) {
        const json = (await res.json()) as { id?: string; object?: string };
        if (!json.id || typeof json.id !== 'string') {
          const err = `Stripe 200 but malformed response (no id field): ${JSON.stringify(json).slice(0, 200)}`;
          console.error('[stripe]', err);
          return { success: false, error: err };
        }
        return { success: true, recordId: json.id };
      }

      const text = await res.text();
      lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;

      // 4xx (excepto 429) son errores permanentes — no reintentamos.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error('[stripe] reportVoiceOverageToStripe permanent error:', lastError);
        return { success: false, error: lastError };
      }

      // 429 / 5xx → backoff exponencial (1s, 2s, 4s)
      if (attempt < maxAttempts) {
        const waitMs = Math.pow(2, attempt - 1) * 1000;
        console.warn(`[stripe] retry ${attempt}/${maxAttempts} after ${waitMs}ms (${lastError})`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  console.error('[stripe] reportVoiceOverageToStripe exhausted retries:', lastError);
  return { success: false, error: lastError };
}
