// ═════════════════════════════════════════════════════════════════════════════
// PROMPT FINE-TUNING PIPELINE — Phase 3.C / 7.C
// Identifica conversaciones fallidas, propone mejora del prompt y la encola
// en prompt_approval_queue para que Javier (admin) apruebe antes de desplegar.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStructured, MODELS } from '@/lib/llm/openrouter';

export interface FailedConversation {
  conversation_id: string;
  agent_name: string;
  messages: Array<{ direction: string; content: string }>;
  failure_reason: 'escalated' | 'misclassified' | 'unresolved' | 'confused';
}

const ImprovementSchema = z.object({
  new_prompt: z.string(),
  changes_summary: z.string(),
  expected_improvement: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. identifyFailedConversations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta conversaciones problemáticas:
 *  - assigned_to IS NOT NULL (escaló a humano)
 *  - status = 'human_handoff'
 *  - summary contiene palabras clave de confusión ("no entendí", "disculpe",
 *    "perdón", "no me quedó claro", "pregúntale al doctor")
 *  - tags incluyen 'escalado' o 'queja'
 */
export async function identifyFailedConversations(opts: {
  tenantId: string;
  dateFrom: string;
}): Promise<FailedConversation[]> {
  // 3 queries en paralelo — cada una captura un modo de fallo distinto
  const [handoffR, confusedR, taggedR] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('id, status, tags, assigned_to, summary')
      .eq('tenant_id', opts.tenantId)
      .gte('last_message_at', opts.dateFrom)
      .or('status.eq.human_handoff,assigned_to.not.is.null'),
    supabaseAdmin
      .from('conversations')
      .select('id, status, tags, assigned_to, summary')
      .eq('tenant_id', opts.tenantId)
      .gte('last_message_at', opts.dateFrom)
      .or(
        'summary.ilike.%no entendí%,summary.ilike.%disculpe%,summary.ilike.%perdón%,summary.ilike.%no me quedó claro%',
      ),
    supabaseAdmin
      .from('conversations')
      .select('id, status, tags, assigned_to, summary')
      .eq('tenant_id', opts.tenantId)
      .gte('last_message_at', opts.dateFrom)
      .or('tags.cs.{escalado},tags.cs.{queja}'),
  ]);

  // Merge y dedupe por id
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of [handoffR.data, confusedR.data, taggedR.data]) {
    for (const c of (r as Array<Record<string, unknown>> | null) || []) {
      if (!rows.has(c.id as string)) rows.set(c.id as string, c);
    }
  }

  const out: FailedConversation[] = [];
  for (const c of Array.from(rows.values()).slice(0, 20)) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content, intent')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true })
      .limit(20);

    const tags = (c.tags as string[] | null) || [];
    const summary = (c.summary as string | null) || '';

    let reason: FailedConversation['failure_reason'];
    if (tags.includes('queja') || tags.includes('escalado')) {
      reason = 'escalated';
    } else if (
      /no entend|disculpe|perd[oó]n|no me qued[oó] claro/i.test(summary)
    ) {
      reason = 'confused';
    } else if (c.status === 'human_handoff' || c.assigned_to) {
      reason = 'unresolved';
    } else {
      reason = 'misclassified';
    }

    const agent_name =
      (msgs?.find((m) => typeof m.intent === 'string' && (m.intent as string).startsWith('orchestrator'))
        ?.intent as string | undefined)
        ?.split('.')[1] || 'unknown';

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

// ─────────────────────────────────────────────────────────────────────────────
// 2. generatePromptImprovement
// ─────────────────────────────────────────────────────────────────────────────

export async function generatePromptImprovement(opts: {
  agentName: string;
  currentPrompt: string;
  failedConversations: FailedConversation[];
  failurePatterns?: string[];
}): Promise<z.infer<typeof ImprovementSchema>> {
  const patterns = opts.failurePatterns || Array.from(new Set(opts.failedConversations.map((c) => c.failure_reason)));

  const examples = opts.failedConversations
    .slice(0, 5)
    .map(
      (c) =>
        `Conv ${c.conversation_id.slice(0, 8)} (${c.failure_reason}):\n${c.messages.map((m) => `[${m.direction}] ${m.content}`).join('\n')}`,
    )
    .join('\n\n---\n\n');

  try {
    const r = await generateStructured({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Eres un experto senior en prompt engineering. Recibes un system prompt actual y conversaciones donde el agente falló. Propones una versión mejorada del prompt que evite esos fallos específicos. Cambios mínimos — NO reescribas todo el prompt, solo ajusta lo necesario. Responde JSON: {new_prompt: string (prompt completo), changes_summary: string (cambios concretos en 1-2 líneas), expected_improvement: string (qué fallos debería corregir)}.',
      messages: [
        {
          role: 'user',
          content: `Agente: ${opts.agentName}\n\n=== PROMPT ACTUAL ===\n${opts.currentPrompt}\n\n=== PATRONES DE FALLO ===\n${patterns.join('\n')}\n\n=== EJEMPLOS ===\n${examples}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. queueForApproval — inserta en cola + notifica al owner
// ─────────────────────────────────────────────────────────────────────────────

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

  // Notificar al owner (best effort) — no bloquear si falla
  try {
    const { notifyOwner } = await import('@/lib/actions/notifications');
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('name')
      .eq('id', opts.tenantId)
      .single();
    const tenantName = (tenant?.name as string) || 'tenant';

    await notifyOwner({
      tenantId: opts.tenantId,
      event: 'new_order', // reusamos el evento más genérico de notificación
      details:
        `📝 Mejora de prompt lista: Agente ${opts.agentName} de ${tenantName}.\n` +
        `Entra al dashboard para aprobar o rechazar.`,
    });
  } catch (err) {
    console.warn('[prompt-finetuning] notifyOwner failed:', err);
  }

  return { queued: true, id: data.id as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyApprovedPrompt — despliega un prompt aprobado a tenant_prompts
// ─────────────────────────────────────────────────────────────────────────────

export async function applyApprovedPrompt(
  approvalId: string,
): Promise<{ applied: boolean; error?: string; tenant_id?: string; agent_name?: string }> {
  // 1. Leer entrada aprobada
  const { data: row, error: readErr } = await supabaseAdmin
    .from('prompt_approval_queue')
    .select('id, tenant_id, agent_name, proposed_prompt, status')
    .eq('id', approvalId)
    .single();

  if (readErr || !row) return { applied: false, error: 'not_found' };
  if (row.status === 'deployed') {
    return { applied: true, tenant_id: row.tenant_id as string, agent_name: row.agent_name as string };
  }
  if (row.status === 'rejected') return { applied: false, error: 'already_rejected' };

  // 2. UPSERT en tenant_prompts
  const { error: upsertErr } = await supabaseAdmin
    .from('tenant_prompts')
    .upsert(
      {
        tenant_id: row.tenant_id,
        agent_name: row.agent_name,
        prompt_text: row.proposed_prompt,
        model_used: 'fine-tuning',
        is_active: true,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,agent_name' },
    );

  if (upsertErr) return { applied: false, error: upsertErr.message };

  // 3. Marcar queue como deployed
  const { error: statusErr } = await supabaseAdmin
    .from('prompt_approval_queue')
    .update({
      status: 'deployed',
      reviewed_at: new Date().toISOString(),
      deployed_at: new Date().toISOString(),
    })
    .eq('id', approvalId);

  if (statusErr) return { applied: false, error: statusErr.message };

  return {
    applied: true,
    tenant_id: row.tenant_id as string,
    agent_name: row.agent_name as string,
  };
}
