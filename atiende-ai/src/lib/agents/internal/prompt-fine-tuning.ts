// ═════════════════════════════════════════════════════════════════════════════
// PROMPT FINE-TUNING PIPELINE — Phase 3.C
// Identifica conversaciones fallidas, propone mejora del prompt y la encola
// en prompt_approval_queue para que Javier apruebe antes de desplegar.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStructured, MODELS } from '@/lib/llm/openrouter';

export interface FailedConversation {
  conversation_id: string;
  agent_name: string;
  messages: Array<{ direction: string; content: string }>;
  failure_reason: 'escalated' | 'misclassified' | 'unresolved';
}

const ImprovementSchema = z.object({
  new_prompt: z.string(),
  changes_summary: z.string(),
  expected_improvement: z.string(),
});

/** Identifica conversaciones que terminaron mal: escaladas o sin resolución. */
export async function identifyFailedConversations(opts: {
  tenantId: string;
  dateFrom: string;
}): Promise<FailedConversation[]> {
  const { data: convs } = await supabaseAdmin
    .from('conversations')
    .select('id, status, tags')
    .eq('tenant_id', opts.tenantId)
    .gte('last_message_at', opts.dateFrom)
    .or('status.eq.human_handoff,tags.cs.{escalado},tags.cs.{queja}');

  if (!convs || convs.length === 0) return [];

  const out: FailedConversation[] = [];
  for (const c of convs.slice(0, 20)) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content, intent')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true })
      .limit(20);

    const tags = (c.tags as string[]) || [];
    const reason: FailedConversation['failure_reason'] =
      tags.includes('queja') || tags.includes('escalado')
        ? 'escalated'
        : c.status === 'human_handoff'
          ? 'unresolved'
          : 'misclassified';

    // Inferir agent_name del último intent que aparezca
    const agent_name =
      (msgs?.find((m) => (m.intent as string)?.startsWith('orchestrator'))?.intent as
        | string
        | undefined)?.split('.')[1] || 'unknown';

    out.push({
      conversation_id: c.id as string,
      agent_name,
      messages: (msgs || []).map((m) => ({
        direction: m.direction as string,
        content: (m.content as string) || '',
      })),
      failure_reason: reason,
    });
  }
  return out;
}

/** Genera variante mejorada del prompt basada en los patrones de fallo. */
export async function generatePromptImprovement(opts: {
  agentName: string;
  currentPrompt: string;
  failedConversations: FailedConversation[];
  failurePatterns: string[];
}): Promise<z.infer<typeof ImprovementSchema>> {
  const examples = opts.failedConversations
    .slice(0, 5)
    .map(
      (c) =>
        `Conv ${c.conversation_id} (${c.failure_reason}):\n${c.messages.map((m) => `[${m.direction}] ${m.content}`).join('\n')}`,
    )
    .join('\n\n---\n\n');

  try {
    const r = await generateStructured({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Eres un experto en prompt engineering. Recibes un system prompt actual y conversaciones donde el agente falló. Propones una versión mejorada del prompt que evite esos fallos. Responde JSON: {new_prompt: string, changes_summary: string, expected_improvement: string}.',
      messages: [
        {
          role: 'user',
          content: `Agente: ${opts.agentName}\n\n=== PROMPT ACTUAL ===\n${opts.currentPrompt}\n\n=== PATRONES DE FALLO ===\n${opts.failurePatterns.join('\n')}\n\n=== EJEMPLOS ===\n${examples}`,
        },
      ],
      schema: ImprovementSchema,
      jsonSchemaName: 'PromptImprovement',
      temperature: 0.3,
      maxTokens: 3000,
    });
    return r.data;
  } catch (err) {
    return {
      new_prompt: opts.currentPrompt,
      changes_summary: '',
      expected_improvement: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Encola la mejora propuesta para revisión humana de Javier. */
export async function queueForApproval(opts: {
  tenantId: string;
  agentName: string;
  currentPrompt: string;
  proposedPrompt: string;
  changesSummary: string;
}): Promise<{ queued: boolean; id?: string; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('prompt_approval_queue')
    .insert({
      tenant_id: opts.tenantId,
      agent_name: opts.agentName,
      current_prompt: opts.currentPrompt,
      proposed_prompt: opts.proposedPrompt,
      changes_summary: opts.changesSummary,
      status: 'pending_review',
    })
    .select('id')
    .single();
  if (error || !data) return { queued: false, error: error?.message };

  // Notify Javier (best effort) — this assumes a system_admin notification channel
  // existe. Phase 3.D agrega el cron + notificación.
  return { queued: true, id: data.id as string };
}
