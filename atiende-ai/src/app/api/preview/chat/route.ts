import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processPreviewMessage } from '@/lib/whatsapp/preview-processor';

// Orchestrator can run up to 2 LLM rounds + tool exec. 60s covers worst case.
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 500;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:preview_chat`, 20, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `message must be ${MAX_MESSAGE_LENGTH} characters or less` },
        { status: 400 },
      );
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, bot_name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json(
        { error: 'No encontramos tu agente. Completa el onboarding primero.' },
        { status: 404 },
      );
    }

    const result = await processPreviewMessage({
      tenantId: tenant.id,
      userId: user.id,
      message,
    });

    return NextResponse.json({
      reply: result.reply,
      toolCalls: result.toolCalls,
      modelUsed: result.modelUsed,
      agentUsed: result.agentUsed,
      botName: tenant.bot_name || 'Asistente',
      businessName: tenant.name,
    });
  } catch (err) {
    console.error('[preview/chat] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
