// ═════════════════════════════════════════════════════════════════════════════
// FAQ GAP DETECTOR — Phase 3.C
// Encuentra preguntas que repetidamente se escalan a humano + clusterea con
// embeddings + propone respuestas FAQ.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';

export interface UnansweredQuestion {
  conversation_id: string;
  message_id: string;
  content: string;
  asked_at: string;
}

export interface QuestionCluster {
  representative: string;
  members: string[];
  frequency: number;
}

/** Extrae preguntas sin respuesta: convs escaladas o con repetición. */
export async function getUnansweredQuestions(opts: {
  tenantId: string;
  dateFrom: string; // ISO
}): Promise<UnansweredQuestion[]> {
  const { data: convs } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .eq('status', 'human_handoff')
    .gte('last_message_at', opts.dateFrom);

  if (!convs || convs.length === 0) return [];

  const out: UnansweredQuestion[] = [];
  for (const c of convs) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('id, content, created_at, direction')
      .eq('conversation_id', c.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(3);
    for (const m of msgs || []) {
      if (m.content && (m.content as string).length >= 8) {
        out.push({
          conversation_id: c.id as string,
          message_id: m.id as string,
          content: m.content as string,
          asked_at: m.created_at as string,
        });
      }
    }
  }
  return out;
}

/**
 * Cluster questions by string-similarity (Jaccard on tokens) — fast, no
 * embeddings call. Phase 3.E puede sustituir por pgvector + embeddings.
 */
export function clusterSimilarQuestions(questions: string[]): QuestionCluster[] {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  };

  const tokens = questions.map((q) => ({ q, t: tokenize(q) }));
  const used = new Set<number>();
  const clusters: QuestionCluster[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const members: string[] = [tokens[i].q];
    for (let j = i + 1; j < tokens.length; j++) {
      if (used.has(j)) continue;
      if (jaccard(tokens[i].t, tokens[j].t) >= 0.5) {
        members.push(tokens[j].q);
        used.add(j);
      }
    }
    if (members.length >= 1) {
      clusters.push({
        representative: members[0],
        members,
        frequency: members.length,
      });
    }
  }
  return clusters.sort((a, b) => b.frequency - a.frequency);
}

/** Para clusters frecuentes (≥3), generar respuesta FAQ sugerida. */
export async function generateFAQSuggestions(
  clusters: QuestionCluster[],
): Promise<Array<{ question: string; suggested_answer: string; frequency: number }>> {
  const out: Array<{ question: string; suggested_answer: string; frequency: number }> = [];
  for (const c of clusters.filter((c) => c.frequency >= 3).slice(0, 10)) {
    try {
      const result = await generateResponse({
        model: MODELS.ORCHESTRATOR_FALLBACK,
        system:
          'Eres un redactor de FAQs para clínicas mexicanas. Recibes una pregunta frecuente y respondes con una FAQ corta (2-3 oraciones), profesional, en español mexicano. Sin emojis excesivos.',
        messages: [{ role: 'user', content: c.representative }],
        temperature: 0.3,
        maxTokens: 200,
      });
      out.push({
        question: c.representative,
        suggested_answer: result.text.trim(),
        frequency: c.frequency,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}
