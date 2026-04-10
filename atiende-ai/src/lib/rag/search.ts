// RAG Knowledge — text-based search (no embeddings, no OpenAI key required).
//
// For the scale of a single-tenant onboarding (20-30 chunks of business info),
// Postgres full-text search via ilike/tsvector is more than sufficient and
// eliminates the dependency on an OpenAI API key for embeddings.
//
// If you later want vector search at scale, add OPENAI_API_KEY and switch
// back to the pgvector approach (the schema already has the embedding column).

import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Search knowledge chunks relevant to a customer's query.
 * Uses Postgres text matching (case-insensitive) against the content.
 */
export async function searchKnowledge(
  tenantId: string,
  query: string,
): Promise<string> {
  // Split query into keywords for broader matching
  const keywords = query
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) {
    return 'No hay informacion especifica disponible para esta consulta.';
  }

  // Search for chunks that match ANY keyword (OR logic, ordered by relevance)
  // Using ilike for simplicity — works well for <1000 chunks per tenant
  const { data, error } = await supabaseAdmin
    .from('knowledge_chunks')
    .select('content, category')
    .eq('tenant_id', tenantId)
    .or(keywords.map((k) => `content.ilike.%${k}%`).join(','))
    .limit(5);

  if (error || !data || data.length === 0) {
    // Fallback: return ALL chunks for this tenant (the system prompt chunk
    // always matches as a general catch-all)
    const { data: fallback } = await supabaseAdmin
      .from('knowledge_chunks')
      .select('content, category')
      .eq('tenant_id', tenantId)
      .limit(3);

    if (!fallback || fallback.length === 0) {
      return 'No hay informacion especifica disponible para esta consulta.';
    }
    return fallback
      .map((d) => `[${d.category}] ${d.content}`)
      .join('\n---\n');
  }

  return data
    .map((d) => `[${d.category}] ${d.content}`)
    .join('\n---\n');
}

/**
 * Ingest a single knowledge chunk (no embedding — text-only).
 */
export async function ingestKnowledge(
  tenantId: string,
  content: string,
  category: string,
  source: string = 'onboarding',
): Promise<void> {
  await supabaseAdmin.from('knowledge_chunks').insert({
    tenant_id: tenantId,
    content,
    category,
    source,
  });
}

/**
 * Ingest multiple knowledge chunks in one batch (no embeddings).
 */
export async function ingestKnowledgeBatch(
  tenantId: string,
  chunks: { content: string; category: string }[],
  source: string = 'onboarding',
): Promise<void> {
  // Clear previous onboarding chunks for this tenant (idempotent re-ingestion)
  if (source === 'onboarding') {
    await supabaseAdmin
      .from('knowledge_chunks')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source', 'onboarding');
  }

  const rows = chunks.map((chunk) => ({
    tenant_id: tenantId,
    content: chunk.content,
    category: chunk.category,
    source,
  }));

  await supabaseAdmin.from('knowledge_chunks').insert(rows);
}
