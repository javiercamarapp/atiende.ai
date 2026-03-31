import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
export async function POST(req: NextRequest) {
  const{tenantId,agentId,action}=await req.json();
  if(action==='activate'){await supabaseAdmin.from('tenant_agents').upsert({tenant_id:tenantId,agent_id:agentId,is_active:true,activated_at:new Date().toISOString()},{onConflict:'tenant_id,agent_id'});}
  else{await supabaseAdmin.from('tenant_agents').update({is_active:false}).eq('tenant_id',tenantId).eq('agent_id',agentId);}
  return NextResponse.json({success:true});
}
