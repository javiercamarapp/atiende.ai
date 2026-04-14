// ═════════════════════════════════════════════════════════════════════════════
// INTENT QUALITY TRACKER — Phase 3.C
// Sample de conversaciones nocturno para detectar misclassifications.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStructured, MODELS } from '@/lib/llm/openrouter';

export interface ConversationSample {
  conversation_id: string;
  messages: Array<{ direction: string; content: string; intent?: string | null }>;
}

const QualitySchema = z.object({
  misclassified: z.boolean(),
  correct_agent: z.string().nullable(),
  evidence: z.string(),
});

/** Toma un sample aleatorio de conversaciones del día para el tenant. */
export async function sampleConversationsForReview(opts: {
  tenantId: string;
  sampleRate: number; // 0..1
  date: string; // YYYY-MM-DD
}): Promise<ConversationSample[]> {
  const dayStart = `${opts.date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60_000).toISOString();

  const { data: convs } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .gte('last_message_at', dayStart)
    .lt('last_message_at', dayEnd);

  if (!convs || convs.length === 0) return [];

  const sampled = convs.filter(() => Math.random() < opts.sampleRate);
  const samples: ConversationSample[] = [];
  for (const c of sampled.slice(0, 50)) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content, intent')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true })
      .limit(20);
    if (msgs && msgs.length >= 2) {
      samples.push({
        conversation_id: c.id as string,
        messages: msgs.map((m) => ({
          direction: m.direction as string,
          content: (m.content as string) || '',
          intent: (m.intent as string | null) ?? null,
        })),
      });
    }
  }
  return samples;
}

/** LLM-evaluación de una conversación: ¿se eligió el agente correcto? */
export async function detectMisclassifiedIntent(
  sample: ConversationSample,
): Promise<z.infer<typeof QualitySchema>> {
  try {
    const result = await generateStructured({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Eres un auditor de calidad de un sistema de agentes WhatsApp para clínicas. Recibes una conversación y decides: ¿el agente activado fue el correcto? ¿El paciente tuvo que repetir su intent? ¿Quedó sin resolución? Responde JSON: {misclassified: boolean, correct_agent: string|null, evidence: string}.',
      messages: [
        {
          role: 'user',
          content: sample.messages.map((m) => `[${m.direction}] ${m.content}`).join('\n'),
        },
      ],
      schema: QualitySchema,
      jsonSchemaName: 'IntentQualityVerdict',
      temperature: 0,
    });
    return result.data;
  } catch {
    return { misclassified: false, correct_agent: null, evidence: 'audit_failed' };
  }
}

export interface QualityReport {
  tenant_id: string;
  date_from: string;
  date_to: string;
  total_audited: number;
  misclassified_count: number;
  misclassification_rate_pct: number;
  top_issues: Array<{ correct_agent: string; count: number; example: string }>;
}

export async function generateQualityReport(opts: {
  tenantId: string;
  results: Array<{ sample: ConversationSample; verdict: z.infer<typeof QualitySchema> }>;
  dateFrom: string;
  dateTo: string;
}): Promise<QualityReport> {
  const total = opts.results.length;
  const wrong = opts.results.filter((r) => r.verdict.misclassified);
  const byAgent = new Map<string, { count: number; example: string }>();
  for (const r of wrong) {
    const ca = r.verdict.correct_agent || 'unknown';
    if (!byAgent.has(ca)) byAgent.set(ca, { count: 0, example: r.verdict.evidence });
    byAgent.get(ca)!.count += 1;
  }
  return {
    tenant_id: opts.tenantId,
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    total_audited: total,
    misclassified_count: wrong.length,
    misclassification_rate_pct: total > 0 ? Math.round((100 * wrong.length) / total) : 0,
    top_issues: Array.from(byAgent.entries())
      .map(([correct_agent, v]) => ({ correct_agent, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
