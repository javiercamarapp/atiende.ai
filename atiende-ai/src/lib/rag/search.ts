import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase/admin';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Memoiza si search_knowledge_hybrid existe en la DB del proyecto. Si la
// primera llamada devuelve 404 (función no aplicada), saltamos directo al
// legacy en todas las requests posteriores. Antes ensuciábamos Vercel logs
// con un 404 por cada mensaje inbound.
let _hybridAvailable: boolean | null = null;

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

  // 2. Hybrid search (pgvector + tsvector con RRF).
  // Mejor recall para queries cortas en español ("cita muela" matchea
  // "extracción dental" vía vector Y "muela" vía tsvector).
  // Fallback automático a search_knowledge legacy si el RPC no existe
  // (tenant sin la migración hybrid_search.sql aplicada).
  type ChunkRow = { content: string; category: string; similarity: number };
  let data: ChunkRow[] | null = null;
  let error: { message: string } | null = null;

  if (_hybridAvailable !== false) {
    const hybrid = await supabaseAdmin.rpc('search_knowledge_hybrid', {
      p_tenant: tenantId,
      p_query: queryEmbedding,
      p_query_text: query,
      p_threshold: 0.30,
      p_limit: 5,
    });

    // Si la función no existe en DB (404 / PGRST202), marcamos para no
    // volver a llamarla en este proceso. Otros errores (timeout, etc) no
    // pivotean el cache — pueden ser transitorios.
    if (hybrid.error?.code === 'PGRST202' || hybrid.error?.code === '42883') {
      _hybridAvailable = false;
    } else {
      _hybridAvailable = true;
    }

    const hybridData = hybrid.data as ChunkRow[] | null;
    if (!hybrid.error && hybridData && hybridData.length > 0) {
      data = hybridData;
    }
  }

  if (!data) {
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

export interface KnowledgeChunkMatch {
  content: string;
  category: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

// Variant of searchKnowledge that returns raw chunks with metadata.
// Used by the knowledge preview-chat endpoint to render "source chips"
// linking an answer back to its zone. Keeps searchKnowledge() untouched so
// the live WhatsApp bot path is not modified in Fase 2.
export async function searchKnowledgeChunks(
  tenantId: string,
  query: string,
  limit: number = 5,
): Promise<KnowledgeChunkMatch[]> {
  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const queryEmbedding = embResponse.data[0].embedding;

  // Direct query: cosine distance via pgvector `<=>` operator.
  // ORDER BY distance ASC, LIMIT N. Returns metadata so callers can map
  // a match back to its owning zone.
  const { data, error } = await supabaseAdmin.rpc('search_knowledge_meta', {
    p_tenant: tenantId,
    p_query: queryEmbedding,
    p_limit: limit,
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    return (data as Array<{
      content: string; category: string | null; source: string | null;
      metadata: Record<string, unknown> | null; similarity: number;
    }>).map((d) => ({
      content: d.content,
      category: d.category,
      source: d.source,
      metadata: d.metadata ?? {},
      similarity: d.similarity,
    }));
  }

  // Fallback when the RPC is not installed: direct table query with
  // `<=>` operator. Slightly slower but works without the function.
  const { data: fallback } = await supabaseAdmin
    .from('knowledge_chunks')
    .select('content, category, source, metadata')
    .eq('tenant_id', tenantId)
    .limit(limit);

  return (fallback ?? []).map((row) => ({
    content: row.content,
    category: row.category,
    source: row.source,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    similarity: 0,
  }));
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

// Ingestar un chunk con metadata JSONB para trazabilidad.
// Usado por save-answer (metadata.question_key/zone), report-correction
// (metadata.origin='faq') y uploads de docs (metadata.doc_id). La metadata
// permite DELETE+INSERT dirigido sin afectar chunks de otras fuentes.
export async function ingestKnowledgeWithMetadata(
  tenantId: string,
  content: string,
  category: string,
  source: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: content,
  });

  await supabaseAdmin.from('knowledge_chunks').insert({
    tenant_id: tenantId,
    content,
    embedding: embResponse.data[0].embedding,
    category,
    source,
    metadata,
  });
}

// Variant of ingestKnowledgeBatch that writes per-chunk metadata JSONB.
// Uses a single OpenAI embeddings API call (supports up to 2048 inputs)
// so tagging metadata doesn't cost extra network trips — critical for the
// initial onboarding path which ingests ~10 chunks at once.
export async function ingestKnowledgeBatchWithMetadata(
  tenantId: string,
  chunks: { content: string; category: string; metadata: Record<string, unknown> }[],
  source: string = 'onboarding',
): Promise<void> {
  if (chunks.length === 0) return;

  const embResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map((c) => c.content),
  });

  const rows = chunks.map((chunk, i) => ({
    tenant_id: tenantId,
    content: chunk.content,
    embedding: embResponse.data[i].embedding,
    category: chunk.category,
    source,
    metadata: chunk.metadata,
  }));

  await supabaseAdmin.from('knowledge_chunks').insert(rows);
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
