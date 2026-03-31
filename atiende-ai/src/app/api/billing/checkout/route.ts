import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/billing/stripe';
import { createOxxoPayment, createSpeiPayment } from '@/lib/billing/conekta';
export async function POST(req: NextRequest) {
  const{tenantId,email,plan,method,name}=await req.json();
  if(method==='stripe'){const s=await createCheckoutSession(tenantId,email,plan);return NextResponse.json({url:s.url});}
  if(method==='oxxo'){const r=await createOxxoPayment(tenantId,email,plan,name);return NextResponse.json(r);}
  if(method==='spei'){const r=await createSpeiPayment(tenantId,email,plan,name);return NextResponse.json(r);}
  return NextResponse.json({error:'Invalid method'},{status:400});
}
