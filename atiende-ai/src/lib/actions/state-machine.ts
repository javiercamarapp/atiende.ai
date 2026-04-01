import { supabaseAdmin } from '@/lib/supabase/admin';

export type ConversationState =
  | 'awaiting_appointment_date'
  | 'awaiting_modify_date'
  | 'awaiting_order_confirmation'
  | 'awaiting_reservation_details'
  | 'awaiting_insurance_data'
  | 'awaiting_insurance_selection'
  | null;

export async function getConversationState(conversationId: string): Promise<{ state: ConversationState; context: Record<string, unknown> }> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('tags')
    .eq('id', conversationId)
    .single();

  // Store state in a special tag format: state:awaiting_appointment_date
  const tags = (data?.tags as string[]) || [];
  const stateTag = tags.find(t => t.startsWith('state:'));
  const contextTag = tags.find(t => t.startsWith('ctx:'));

  return {
    state: stateTag ? stateTag.replace('state:', '') as ConversationState : null,
    context: contextTag ? JSON.parse(contextTag.replace('ctx:', '')) : {},
  };
}

export async function setConversationState(
  conversationId: string,
  state: ConversationState,
  context?: Record<string, unknown>
) {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('tags')
    .eq('id', conversationId)
    .single();

  let tags = ((data?.tags as string[]) || []).filter(t => !t.startsWith('state:') && !t.startsWith('ctx:'));

  if (state) {
    tags.push(`state:${state}`);
    if (context) tags.push(`ctx:${JSON.stringify(context)}`);
  }

  await supabaseAdmin.from('conversations').update({ tags }).eq('id', conversationId);
}

export async function clearConversationState(conversationId: string) {
  await setConversationState(conversationId, null);
}
