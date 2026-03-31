import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ingestKnowledge } from '@/lib/rag/search';
export async function POST(req: NextRequest) {
  const{tenantId}=await req.json();
  await supabaseAdmin.from('knowledge_chunks').delete().eq('tenant_id',tenantId).in('category',['servicios','precios']);
  const{data:svcs}=await supabaseAdmin.from('services').select('name,price,duration_minutes').eq('tenant_id',tenantId);
  if(!svcs?.length)return NextResponse.json({ok:true});
  const content='SERVICIOS Y PRECIOS:\n'+svcs.map(s=>`${s.name} - $${s.price} MXN (${s.duration_minutes} min)`).join('\n');
  await ingestKnowledge(tenantId,content,'servicios');
  return NextResponse.json({ok:true,count:svcs.length});
}
