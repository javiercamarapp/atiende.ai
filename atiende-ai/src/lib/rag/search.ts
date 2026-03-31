import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase/admin';

// OpenAI directo para embeddings (mas barato que via OpenRouter)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Buscar conocimiento relevante del negocio (RAG)
// Esto es lo que PREVIENE alucinaciones
export async function searchKnowledge(
  tenantId: string,
  query: string
): Promise<string> {
  // 1. Generar embedding del query del cliente
  const embResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small', // $0.02/M tokens
    input: query,
  });
  const queryEmbedding = embResponse.data[0].embedding;

  // 2. Buscar chunks mas relevantes de ESE negocio
  const { data, error } = await supabaseAdmin.rpc('search_knowledge', {
    p_tenant: tenantId,
    p_query: queryEmbedding,
    p_threshold: 0.35, // minimo de similitud
    p_limit: 5,        // max chunks a devolver
  });

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
  const embResponse = await openai.embeddings.create({
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
  const embResponse = await openai.embeddings.create({
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
