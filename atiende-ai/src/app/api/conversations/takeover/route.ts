import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const { conversationId, action } = await req.json();
  await supabaseAdmin.from('conversations').update({status:action==='takeover'?'human_handoff':'active'}).eq('id',conversationId);
  return NextResponse.json({ success: true });
}
