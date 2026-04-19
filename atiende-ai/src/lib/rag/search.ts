import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase/admin';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Buscar conocimiento relevante del negocio (RAG)
// Esto es lo que PREVIENE alucinaciones
export async function searchKnowledge(
  tenantId: string,
  query: string
): Promise<string> {
  // 1. Generar embedding del query del cliente
  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small', // $0.02/M tokens
    input: query,
  });
  const queryEmbedding = embResponse.data[0].embedding;

  // 2. Hybrid search (pgvector + tsvector con RRF) — AUDIT R13 rubro AI/ML.
  // Mejor recall para queries cortas en español ("cita muela" matchea
  // "extracción dental" vía vector Y "muela" vía tsvector).
  // Fallback automático a search_knowledge legacy si el RPC no existe
  // (tenant sin la migración hybrid_search.sql aplicada).
  type ChunkRow = { content: string; category: string; similarity: number };
  let data: ChunkRow[] | null = null;
  let error: { message: string } | null = null;

  const hybrid = await supabaseAdmin.rpc('search_knowledge_hybrid', {
    p_tenant: tenantId,
    p_query: queryEmbedding,
    p_query_text: query,
    p_threshold: 0.30,
    p_limit: 5,
  });

  const hybridData = hybrid.data as ChunkRow[] | null;
  if (!hybrid.error && hybridData && hybridData.length > 0) {
    data = hybridData;
  } else {
    // Fallback: vector-only legacy
    const legacy = await supabaseAdmin.rpc('search_knowledge', {
      p_tenant: tenantId,
      p_query: queryEmbedding,
      p_threshold: 0.35,
      p_limit: 5,
    });
    data = legacy.data as ChunkRow[] | null;
    error = legacy.error;
  }

  if (error || !data || data.length === 0) {
    return 'No hay informacion especifica disponible para esta consulta.';
  }

  // 3. Formatear contexto para el LLM
  return data
    .map((d: { content: string; category: string; similarity: number }) =>
      `[${d.category}] ${d.content}`)
    .join('\n---\n');
}

// Ingestar nuevo conocimiento (usado en onboarding y manual)
export async function ingestKnowledge(
  tenantId: string,
  content: string,
  category: string,
  source: string = 'onboarding'
): Promise<void> {
  // Generar embedding
  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: content,
  });

  // Insertar en pgvector
  await supabaseAdmin.from('knowledge_chunks').insert({
    tenant_id: tenantId,
    content,
    embedding: embResponse.data[0].embedding,
    category,
    source,
  });
}

// Ingestar multiples chunks de una vez (batch)
export async function ingestKnowledgeBatch(
  tenantId: string,
  chunks: { content: string; category: string }[],
  source: string = 'onboarding'
): Promise<void> {
  // Generar embeddings en batch (OpenAI soporta hasta 2048 inputs)
  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map(c => c.content),
  });

  // Insertar todos
  const rows = chunks.map((chunk, i) => ({
    tenant_id: tenantId,
    content: chunk.content,
    embedding: embResponse.data[i].embedding,
    category: chunk.category,
    source,
  }));

  await supabaseAdmin.from('knowledge_chunks').insert(rows);
}
