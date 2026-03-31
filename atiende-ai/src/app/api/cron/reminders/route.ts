import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
export const dynamic = 'force-dynamic';
export async function GET() {
  const now=new Date();const in24=new Date(now.getTime()+24*60*60*1000);const in23=new Date(now.getTime()+23*60*60*1000);
  const{data:a24}=await supabaseAdmin.from('appointments').select('*, tenants(wa_phone_number_id,name)').gte('datetime',in23.toISOString()).lte('datetime',in24.toISOString()).eq('status','scheduled').eq('reminder_24h_sent',false);
  // Send 24h reminders via WA template (requires approved Meta templates)
  const in1=new Date(now.getTime()+60*60*1000);
  const{data:a1}=await supabaseAdmin.from('appointments').select('*, tenants(wa_phone_number_id,name)').gte('datetime',now.toISOString()).lte('datetime',in1.toISOString()).in('status',['scheduled','confirmed']).eq('reminder_1h_sent',false);
  return NextResponse.json({sent24h:a24?.length||0,sent1h:a1?.length||0});
}
