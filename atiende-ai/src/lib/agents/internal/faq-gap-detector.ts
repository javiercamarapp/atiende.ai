// ═════════════════════════════════════════════════════════════════════════════
// FAQ GAP DETECTOR — Phase 3.C / 7.B
// Encuentra preguntas que repetidamente se escalan a humano + clusterea con
// embeddings reales (text-embedding-3-small vía OpenRouter, distancia coseno
// en pgvector). Fallback a Jaccard si el embedding falla.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, getOpenRouter, MODELS } from '@/lib/llm/openrouter';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface UnansweredQuestion {
  conversation_id: string;
  message_id: string;
  content: string;
  asked_at: string;
}

export interface QuestionCluster {
  /** Si viene de DB, es el cluster_id. Si es in-memory, índice secuencial. */
  cluster_id: number;
  representative: string;
  /** Alias legacy — mismo texto que representative. */
  representative_question?: string;
  members: string[];
  questions?: string[];
  frequency: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'openai/text-embedding-3-small'; // 1536 dims
const SIMILARITY_THRESHOLD = 0.2; // coseno distance < 0.2 = muy similar

// ─────────────────────────────────────────────────────────────────────────────
// Extraer preguntas no respondidas (sin cambios desde 3.C)
// ─────────────────────────────────────────────────────────────────────────────

export async function getUnansweredQuestions(opts: {
  tenantId: string;
  dateFrom: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Embeddings vía OpenRouter (SDK compatible con OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const client = getOpenRouter();
    const r = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 4000),
    });
    const v = r.data?.[0]?.embedding;
    if (!v || !Array.isArray(v)) return null;
    return v as number[];
  } catch (err) {
    console.warn('[faq-gap] embedding failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clustering con pgvector (cosine distance)
//
// Flujo:
//   1. Para cada pregunta, generar embedding
//   2. INSERT en faq_embeddings
//   3. Para cada una, consultar vecinos con `embedding <=> other < THRESHOLD`
//   4. Union-find para agrupar en clusters
// ─────────────────────────────────────────────────────────────────────────────

export async function clusterSimilarQuestions(
  questions: string[],
  opts: { tenantId?: string } = {},
): Promise<QuestionCluster[]> {
  if (questions.length === 0) return [];

  // Embedding por pregunta (paralelo)
  const embeddings = await Promise.all(questions.map((q) => generateEmbedding(q)));

  // Fallback Jaccard si embeddings no disponibles (no hay API key, error, etc.)
  if (embeddings.every((e) => e === null)) {
    return clusterWithJaccard(questions);
  }

  // Persistir (si hay tenantId) para histórico
  const tenantId = opts.tenantId;
  const rowsToInsert: Array<{ question: string; embedding: number[] | null; idx: number }> = [];
  for (let i = 0; i < questions.length; i++) {
    if (embeddings[i]) rowsToInsert.push({ question: questions[i], embedding: embeddings[i], idx: i });
  }

  if (tenantId && rowsToInsert.length > 0) {
    try {
      await supabaseAdmin.from('faq_embeddings').insert(
        rowsToInsert.map((r) => ({
          tenant_id: tenantId,
          question_text: r.question,
          // pgvector acepta string "[0.1, 0.2, ...]" o array; supabase-js serializa array
          embedding: r.embedding,
          frequency: 1,
        })),
      );
    } catch (err) {
      console.warn('[faq-gap] persist faq_embeddings failed:', err);
    }
  }

  // Clustering in-memory con cosine similarity directa sobre los vectores
  return clusterWithEmbeddings(questions, embeddings);
}

// ─────────────────────────────────────────────────────────────────────────────
// Clustering in-memory con cosine similarity
// ─────────────────────────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function clusterWithEmbeddings(questions: string[], embeddings: Array<number[] | null>): QuestionCluster[] {
  const used = new Set<number>();
  const out: QuestionCluster[] = [];
  let clusterId = 0;

  for (let i = 0; i < questions.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const members: string[] = [questions[i]];
    const ei = embeddings[i];

    if (ei) {
      for (let j = i + 1; j < questions.length; j++) {
        if (used.has(j)) continue;
        const ej = embeddings[j];
        if (!ej) continue;
        const sim = cosine(ei, ej); // 1 = idéntico, 0 = ortogonal
        const distance = 1 - sim;
        if (distance < SIMILARITY_THRESHOLD) {
          members.push(questions[j]);
          used.add(j);
        }
      }
    }

    out.push({
      cluster_id: clusterId++,
      representative: members[0],
      representative_question: members[0],
      members,
      questions: members,
      frequency: members.length,
    });
  }

  return out.sort((a, b) => b.frequency - a.frequency);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback Jaccard (preservado de 3.C)
// ─────────────────────────────────────────────────────────────────────────────

function clusterWithJaccard(questions: string[]): QuestionCluster[] {
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
  let clusterId = 0;
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
    clusters.push({
      cluster_id: clusterId++,
      representative: members[0],
      representative_question: members[0],
      members,
      questions: members,
      frequency: members.length,
    });
  }
  return clusters.sort((a, b) => b.frequency - a.frequency);
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQ Suggestions (sin cambios vs 3.C)
// ─────────────────────────────────────────────────────────────────────────────

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
