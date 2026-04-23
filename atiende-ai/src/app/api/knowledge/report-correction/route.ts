import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';
import { ingestKnowledgeWithMetadata } from '@/lib/rag/search';

// LLM embedding call + DB writes. Same budget as save-answer.
export const maxDuration = 30;

const BodySchema = z.object({
  // Two invocation shapes:
  // A) candidateId: resolve a pending review_candidate
  // B) free-form: user-initiated correction from the bot preview menu ⋯
  candidateId: z.string().uuid().optional(),
  customerMessage: z.string().min(1).max(1000).optional(),
  correctResponse: z.string().min(1).max(2000),
  saveAsFaq: z.boolean().default(true),
}).refine(
  (d) => d.candidateId || d.customerMessage,
  { message: 'Either candidateId or customerMessage is required' },
);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:report_correction`, 30, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { candidateId, customerMessage, correctResponse, saveAsFaq } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const log = logger.child({ route: 'report-correction', tenant_id: tenant.id });
    let question = customerMessage ?? '';

    // Shape A — mark the candidate resolved, pull the message for the chunk.
    if (candidateId) {
      const { data: candidate, error: candErr } = await supabaseAdmin
        .from('review_candidates')
        .select('id, tenant_id, customer_message')
        .eq('id', candidateId)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (candErr || !candidate) {
        return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
      }

      question = candidate.customer_message;

      const { error: updateErr } = await supabaseAdmin
        .from('review_candidates')
        .update({
          reviewed: true,
          corrected_response: correctResponse,
          saved_as_faq: saveAsFaq,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', candidateId);

      if (updateErr) {
        log.error('Failed to update candidate', new Error(updateErr.message));
        return NextResponse.json({ error: 'Failed to mark reviewed' }, { status: 500 });
      }
    }

    // Ingest the Q/A pair into knowledge_chunks so the bot learns it.
    if (saveAsFaq) {
      const content = `P: ${question}\nR: ${correctResponse}`;
      try {
        await ingestKnowledgeWithMetadata(
          tenant.id,
          content,
          'faq',
          'faq',
          {
            origin: 'correction',
            candidate_id: candidateId ?? null,
            learned_from_question: question,
          },
        );
      } catch (err) {
        log.error('Failed to ingest FAQ chunk', err instanceof Error ? err : new Error(String(err)));
        return NextResponse.json(
          {
            ok: true,
            warning: 'Guardamos tu corrección, pero el bot tardará unos minutos en aprenderla.',
          },
          { status: 200 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[report-correction] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
