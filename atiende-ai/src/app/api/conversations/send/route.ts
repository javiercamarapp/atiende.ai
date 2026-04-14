import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { createServerSupabase } from '@/lib/supabase/server';
import { z } from 'zod';

// Security fix: previously accepted `phoneNumberId` and `to` from the request
// body. Since `sendTextMessage` uses a shared `WA_SYSTEM_TOKEN` with
// permissions on all tenants' phone numbers, a malicious tenant could spoof
// messages from ANOTHER tenant's WhatsApp number. Now we:
//   1. Derive `phoneNumberId` server-side from the authenticated tenant.
//   2. Derive `to` from the conversation record (the actual customer phone).
// The client only needs to tell us WHICH conversation to reply in + the text.
const SendSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4096),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:conversations_send`, 20, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, wa_phone_number_id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }
    if (!tenant.wa_phone_number_id) {
      return NextResponse.json(
        { error: 'WhatsApp phone number not configured for this tenant' },
        { status: 400 },
      );
    }

    const tenantId = tenant.id;
    const body = await req.json();
    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }
    const { conversationId, text } = parsed.data;

    // Look up conversation to get both (a) tenant ownership check and
    // (b) the customer_phone that must be the recipient of the outbound msg.
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id, customer_phone')
      .eq('id', conversationId)
      .eq('tenant_id', tenantId)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Both `from` and `to` are now server-derived — the client can't influence
    // which WA number sends or which number receives.
    await sendTextMessage(
      tenant.wa_phone_number_id as string,
      conversation.customer_phone as string,
      text,
    );
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
