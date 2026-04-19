import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';

export const maxDuration = 30;

interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_TURNS = 10;
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
    const history: HistoryTurn[] = Array.isArray(body?.history) ? body.history : [];

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
      .select('id, name, business_type, chat_system_prompt, welcome_message, bot_name')
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

    const systemPrompt = tenant.chat_system_prompt
      || `Eres ${tenant.bot_name || 'un asistente'} de ${tenant.name}. Responde en español (México), breve y cordial. Estás en un preview — no hagas reservas reales.`;

    const trimmedHistory = history
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_LENGTH) }));

    const result = await generateResponse({
      model: MODELS.STANDARD,
      system: systemPrompt,
      messages: [...trimmedHistory, { role: 'user', content: message }],
      maxTokens: 400,
    });

    return NextResponse.json({
      reply: result.text,
      botName: tenant.bot_name || 'Asistente',
      businessName: tenant.name,
    });
  } catch (err) {
    console.error('[preview/chat] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
