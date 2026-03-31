import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const tenantId = tenant.id;
    const { conversationId, phoneNumberId, to, text } = await req.json();

    // Verify conversation belongs to the authenticated tenant
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('tenant_id', tenantId)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    await sendTextMessage(phoneNumberId, to, text);
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      direction: 'outbound',
      sender_type: 'human',
      content: text,
      message_type: 'text',
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
