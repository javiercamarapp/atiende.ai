import { supabaseAdmin } from '@/lib/supabase/admin';
import { ingestKnowledgeWithMetadata } from '@/lib/rag/search';
import { ZONES, zoneForQuestionKey, type ZoneId } from '@/lib/knowledge/zone-map';
import { regeneratePrompt } from '@/lib/knowledge/prompt-builder';
import { logger } from '@/lib/logger';

export type SaveAnswerResult =
  | { ok: true; zoneId: ZoneId; cleared?: boolean }
  | { ok: true; zoneId: ZoneId; warning: string }
  | { ok: false; error: string };

export interface SaveAnswerInput {
  tenantId: string;
  questionKey: string;
  questionLabel?: string;
  answer: unknown;
  step?: number;
}

export function answerToText(answer: unknown): string {
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

export function answerToJson(answer: unknown): Record<string, unknown> {
  if (typeof answer === 'string') return { text: answer };
  return { value: answer };
}

// Atomic write used by the save-answer route and the backfill admin route.
// Pattern: DELETE old response → INSERT new response → DELETE old chunk(s)
// tagged with this question_key → INSERT fresh chunk with metadata.
//
// Chunk ingest failures degrade gracefully: the response is already
// persisted, so we return { warning } and log. The UI keeps moving; the
// bot's next RAG query will miss until the engineer follows up.
export async function saveAnswerAtomic(input: SaveAnswerInput): Promise<SaveAnswerResult> {
  const { tenantId, questionKey, questionLabel, answer, step = 4 } = input;
  const log = logger.child({ helper: 'saveAnswerAtomic', tenant_id: tenantId, question_key: questionKey });
  const zoneId = zoneForQuestionKey(questionKey);
  const zone = ZONES.find((z) => z.id === zoneId)!;

  const { error: deleteRespError } = await supabaseAdmin
    .from('onboarding_responses')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('question_key', questionKey);

  if (deleteRespError) {
    log.error('Failed to delete old response', new Error(deleteRespError.message));
    return { ok: false, error: 'Failed to save answer' };
  }

  const { error: insertRespError } = await supabaseAdmin
    .from('onboarding_responses')
    .insert({
      tenant_id: tenantId,
      step,
      question_key: questionKey,
      answer: answerToJson(answer),
    });

  if (insertRespError) {
    log.error('Failed to insert response', new Error(insertRespError.message));
    return { ok: false, error: 'Failed to save answer' };
  }

  const answerText = answerToText(answer);

  // Always wipe previous chunks for this question_key. If the answer is
  // empty we're done (the user cleared their response).
  const { error: deleteChunkError } = await supabaseAdmin
    .from('knowledge_chunks')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('source', 'onboarding')
    .eq('metadata->>question_key', questionKey);

  if (deleteChunkError) {
    log.warn('Failed to delete old chunks, continuing', { error: deleteChunkError.message });
  }

  if (!answerText) {
    regeneratePrompt(tenantId).catch((err) => {
      log.warn('Prompt regeneration failed on clear', { error: err instanceof Error ? err.message : String(err) });
    });
    return { ok: true, zoneId, cleared: true };
  }

  const chunkContent = questionLabel
    ? `${questionLabel.toUpperCase()}: ${answerText}`
    : answerText;

  try {
    await ingestKnowledgeWithMetadata(
      tenantId,
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
    log.error('Failed to ingest chunk', err instanceof Error ? err : new Error(String(err)));
    return {
      ok: true,
      zoneId,
      warning: 'Tu respuesta se guardó, pero el bot tardará unos minutos en aprenderla.',
    };
  }

  // Regenerate the system prompt with all accumulated knowledge.
  // Fire-and-forget: prompt rebuild is best-effort. If it fails the
  // old prompt stays and RAG still has the latest chunk.
  regeneratePrompt(tenantId).catch((err) => {
    log.warn('Prompt regeneration failed', { error: err instanceof Error ? err.message : String(err) });
  });

  return { ok: true, zoneId };
}
