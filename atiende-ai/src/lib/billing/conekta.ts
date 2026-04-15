import axios from 'axios';
const API = 'https://api.conekta.io';
const headers = () => ({
  Authorization:`Bearer ${process.env.CONEKTA_PRIVATE_KEY}`,
  'Content-Type':'application/json',
  'Accept':'application/vnd.conekta-v2.2.0+json',
});
// Precios (centavos MXN) — leídos de env vars para evitar drift con Stripe.
// Fallback a los defaults actuales si las env vars no están configuradas.
//   basic   $599   = WhatsApp Básico (sin voz)
//   pro     $999   = legacy
//   premium $1,499 = WhatsApp + Voz (200 min incluidos + $5/min overage)
const AMOUNTS:Record<string,number> = {
  basic:   Number(process.env.CONEKTA_AMOUNT_BASIC   || 59900),
  pro:     Number(process.env.CONEKTA_AMOUNT_PRO     || 99900),
  premium: Number(process.env.CONEKTA_AMOUNT_PREMIUM || 149900),
};

export async function createOxxoPayment(tenantId:string, email:string, plan:string, name:string) {
  const { data } = await axios.post(`${API}/orders`, {
    currency:'MXN', customer_info:{name,email,phone:'5555555555'},
    line_items:[{name:`Plan ${plan} - useatiende.ai`,unit_price:AMOUNTS[plan],quantity:1}],
    charges:[{payment_method:{type:'oxxo_cash',expires_at:Math.floor(Date.now()/1000)+259200}}],
    metadata:{tenant_id:tenantId,plan},
  },{headers:headers()});
  const c = data.charges?.data?.[0];
  return { orderId:data.id, oxxoReference:c?.payment_method?.reference, barcodeUrl:c?.payment_method?.barcode_url };
}

export async function createSpeiPayment(tenantId:string, email:string, plan:string, name:string) {
  const { data } = await axios.post(`${API}/orders`, {
    currency:'MXN', customer_info:{name,email,phone:'5555555555'},
    line_items:[{name:`Plan ${plan} - useatiende.ai`,unit_price:AMOUNTS[plan],quantity:1}],
    charges:[{payment_method:{type:'spei'}}],
    metadata:{tenant_id:tenantId,plan},
  },{headers:headers()});
  const c = data.charges?.data?.[0];
  return { orderId:data.id, clabe:c?.payment_method?.clabe };
}
