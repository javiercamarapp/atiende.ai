import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';
import { saveAnswerAtomic } from '@/lib/knowledge/save-answer';

// Embedding call + DB writes. 30s is plenty; p95 observed ~800ms.
export const maxDuration = 30;

const BodySchema = z.object({
  questionKey: z.string().min(1).max(80),
  // answer is intentionally permissive — the quiz UI sends strings, numbers,
  // booleans, arrays of strings, and small objects. Serialisation lives in
  // the saveAnswerAtomic helper.
  answer: z.unknown(),
  questionLabel: z.string().min(1).max(300).optional(),
  step: z.number().int().nonnegative().default(4),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:save_answer`, 60, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { questionKey, answer, questionLabel, step } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
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

    const result = await saveAnswerAtomic({
      tenantId: tenant.id,
      questionKey,
      questionLabel,
      answer,
      step,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err) {
    logger.error('[save-answer] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
