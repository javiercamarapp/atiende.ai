import { NextRequest, NextResponse } from 'next/server';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:test_bot`, 10, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const { message, businessType, businessInfo, answers } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ error: 'message must be 500 characters or less' }, { status: 400 });
    }

    const ctx = Object.entries(answers || {})
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');

    const result = await generateResponse({
      model: MODELS.STANDARD,
      system: `Eres asistente de ${businessInfo?.name || 'Mi Negocio'}.\n${ctx}`,
      messages: [{ role: 'user', content: message }],
      maxTokens: 300,
    });

    return NextResponse.json({ reply: result.text });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
