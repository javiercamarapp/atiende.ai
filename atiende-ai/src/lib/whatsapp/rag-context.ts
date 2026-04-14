import { supabaseAdmin } from '@/lib/supabase/admin';
import { searchKnowledge } from '@/lib/rag/search';

/**
 * Fetches RAG knowledge context and recent conversation history
 * needed to build a grounded LLM response.
 */
export async function buildRagContext(
  tenantId: string,
  content: string,
  conversationId: string,
): Promise<{ ragContext: string; history: Array<{ direction: string; sender_type: string; content: string }> }> {
  const [ragContext, { data: history }] = await Promise.all([
    searchKnowledge(tenantId, content),
    supabaseAdmin
      .from('messages')
      .select('direction, sender_type, content')
      .eq('conversation_id', conversationId)
      // Defense-in-depth: filter by tenant_id too. `conversationId` is
      // already validated upstream, but if a bug corrupts it we still
      // refuse to read history from a different tenant.
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(8),
  ]);

  return {
    ragContext,
    history: (history || []) as Array<{ direction: string; sender_type: string; content: string }>,
  };
}
