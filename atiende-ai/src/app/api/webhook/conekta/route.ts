import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
export async function POST(req: NextRequest) {
  const body=await req.json();
  if(body.type==='order.paid'){const tid=body.data?.object?.metadata?.tenant_id;const plan=body.data?.object?.metadata?.plan;if(tid&&plan)await supabaseAdmin.from('tenants').update({plan}).eq('id',tid);}
  return NextResponse.json({received:true});
}
