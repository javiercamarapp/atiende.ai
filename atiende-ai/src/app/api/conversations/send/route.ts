import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';

export async function POST(req: NextRequest) {
  const { conversationId, tenantId, phoneNumberId, to, text } = await req.json();
  await sendTextMessage(phoneNumberId, to, text);
  await supabaseAdmin.from('messages').insert({conversation_id:conversationId,tenant_id:tenantId,direction:'outbound',sender_type:'human',content:text,message_type:'text'});
  return NextResponse.json({ success: true });
}
