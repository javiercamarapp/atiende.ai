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
      .order('created_at', { ascending: true })
      .limit(8),
  ]);

  return {
    ragContext,
    history: (history || []) as Array<{ direction: string; sender_type: string; content: string }>,
  };
}
