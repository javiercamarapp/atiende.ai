import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';
import { ingestKnowledgeWithMetadata } from '@/lib/rag/search';
import { zoneForQuestionKey, ZONES } from '@/lib/knowledge/zone-map';

// Embedding call + DB writes. 30s is plenty; p95 observed ~800ms.
export const maxDuration = 30;

const BodySchema = z.object({
  questionKey: z.string().min(1).max(80),
  // answer is intentionally permissive — the quiz UI sends strings, numbers,
  // booleans, arrays of strings, and small objects. We serialise safely.
  answer: z.unknown(),
  questionLabel: z.string().min(1).max(300).optional(),
  step: z.number().int().nonnegative().default(4),
});

function answerToText(answer: unknown): string {
  if (answer === null || answer === undefined) return '';
  if (typeof answer === 'string') return answer.trim();
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  if (Array.isArray(answer)) return answer.map((a) => answerToText(a)).filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if ('value' in obj) return answerToText(obj.value);
    return JSON.stringify(obj);
  }
  return '';
}

function answerToJson(answer: unknown): Record<string, unknown> {
  if (typeof answer === 'string') return { text: answer };
  return { value: answer };
}

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
      .select('id, business_type')
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

    const log = logger.child({ route: 'save-answer', tenant_id: tenant.id, question_key: questionKey });
    const zoneId = zoneForQuestionKey(questionKey);
    const zone = ZONES.find((z) => z.id === zoneId)!;

    // ── STEP 1: replace the onboarding_response row ─────────────────────────
    // schema has no UNIQUE on (tenant_id, question_key) so we DELETE+INSERT
    // to guarantee single source of truth.
    const { error: deleteRespError } = await supabaseAdmin
      .from('onboarding_responses')
      .delete()
      .eq('tenant_id', tenant.id)
      .eq('question_key', questionKey);

    if (deleteRespError) {
      log.error('Failed to delete old response', new Error(deleteRespError.message));
      return NextResponse.json({ error: 'Failed to save answer' }, { status: 500 });
    }

    const { error: insertRespError } = await supabaseAdmin
      .from('onboarding_responses')
      .insert({
        tenant_id: tenant.id,
        step,
        question_key: questionKey,
        answer: answerToJson(answer),
      });

    if (insertRespError) {
      log.error('Failed to insert response', new Error(insertRespError.message));
      return NextResponse.json({ error: 'Failed to save answer' }, { status: 500 });
    }

    // ── STEP 2: replace the knowledge_chunk for this question_key ───────────
    // Never blocks the response — ingest failures degrade gracefully: the
    // caller keeps the UI updated, we flag a warning so the client can
    // surface a subtle indicator + an engineer can follow up from logs.
    const answerText = answerToText(answer);
    if (!answerText) {
      // Empty string => treat as clearing the answer. Chunks are already
      // deleted below. Caller gets { ok: true, cleared: true }.
      await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('tenant_id', tenant.id)
        .eq('source', 'onboarding')
        .eq('metadata->>question_key', questionKey);

      return NextResponse.json({ ok: true, cleared: true, zoneId });
    }

    const { error: deleteChunkError } = await supabaseAdmin
      .from('knowledge_chunks')
      .delete()
      .eq('tenant_id', tenant.id)
      .eq('source', 'onboarding')
      .eq('metadata->>question_key', questionKey);

    if (deleteChunkError) {
      log.warn('Failed to delete old chunks, continuing', { error: deleteChunkError.message });
    }

    const chunkContent = questionLabel
      ? `${questionLabel.toUpperCase()}: ${answerText}`
      : answerText;

    try {
      await ingestKnowledgeWithMetadata(
        tenant.id,
        chunkContent,
        zone.category,
        'onboarding',
        {
          question_key: questionKey,
          zone: zoneId,
          question_label: questionLabel ?? null,
        },
      );
    } catch (err) {
      // Response is already saved — surface as warning, don't roll back.
      log.error('Failed to ingest chunk', err instanceof Error ? err : new Error(String(err)));
      return NextResponse.json(
        {
          ok: true,
          zoneId,
          warning: 'Tu respuesta se guardó, pero el bot tardará unos minutos en aprenderla.',
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, zoneId });
  } catch (err) {
    logger.error('[save-answer] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
