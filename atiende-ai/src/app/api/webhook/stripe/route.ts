import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
export async function POST(req: NextRequest) {
  const body=await req.text();const sig=req.headers.get('stripe-signature')!;let event;
  try{event=stripe.webhooks.constructEvent(body,sig,process.env.STRIPE_WEBHOOK_SECRET!);}catch{return NextResponse.json({error:'Invalid sig'},{status:400});}
  if(event.type==='checkout.session.completed'){const s=event.data.object;const tid=s.metadata?.tenant_id;const plan=s.metadata?.plan;if(tid&&plan)await supabaseAdmin.from('tenants').update({plan,stripe_customer_id:s.customer as string}).eq('id',tid);}
  if(event.type==='customer.subscription.deleted'){const sub=event.data.object;const{data:t}=await supabaseAdmin.from('tenants').select('id').eq('stripe_customer_id',sub.customer).single();if(t)await supabaseAdmin.from('tenants').update({plan:'free_trial',status:'paused'}).eq('id',t.id);}
  return NextResponse.json({received:true});
}
