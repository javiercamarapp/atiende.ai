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

const PLAN_PRICES: Record<string,string> = {
  basic:'price_basic_499_mxn', pro:'price_pro_999_mxn', premium:'price_premium_1499_mxn',
};

export async function createCheckoutSession(tenantId:string, email:string, plan:string) {
  return getStripe().checkout.sessions.create({
    customer_email:email, mode:'subscription',
    line_items:[{price:PLAN_PRICES[plan],quantity:1}],
    success_url:`${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?success=true`,
    cancel_url:`${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?cancelled=true`,
    metadata:{tenant_id:tenantId,plan}, currency:'mxn', allow_promotion_codes:true,
  });
}

export async function createPortalSession(customerId:string) {
  return getStripe().billingPortal.sessions.create({
    customer:customerId,
    return_url:`${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });
}
