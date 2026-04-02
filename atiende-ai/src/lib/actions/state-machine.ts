import { supabaseAdmin } from '@/lib/supabase/admin';

export enum ConversationStateEnum {
  AWAITING_APPOINTMENT_DATE = 'awaiting_appointment_date',
  AWAITING_MODIFY_DATE = 'awaiting_modify_date',
  AWAITING_ORDER_CONFIRMATION = 'awaiting_order_confirmation',
  AWAITING_RESERVATION_DETAILS = 'awaiting_reservation_details',
}

export type ConversationState = `${ConversationStateEnum}` | null;

interface ConversationStateRecord {
  state: ConversationState;
  context: Record<string, unknown>;
}

/**
 * Reads conversation state from the `metadata` JSONB column on the conversations table.
 * Schema: metadata.conversation_state = { state: string, context: {} }
 */
export async function getConversationState(conversationId: string): Promise<ConversationStateRecord> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  const metadata = (data?.metadata as Record<string, unknown>) || {};
  const stateData = metadata.conversation_state as ConversationStateRecord | undefined;

  return {
    state: stateData?.state ?? null,
    context: stateData?.context ?? {},
  };
}

/**
 * Writes conversation state into the `metadata` JSONB column.
 * Merges with existing metadata so other keys are preserved.
 */
export async function setConversationState(
  conversationId: string,
  state: ConversationState,
  context?: Record<string, unknown>
) {
  // Read existing metadata to merge
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  const metadata = (data?.metadata as Record<string, unknown>) || {};

  if (state) {
    metadata.conversation_state = { state, context: context ?? {} };
  } else {
    delete metadata.conversation_state;
  }

  await supabaseAdmin
    .from('conversations')
    .update({ metadata })
    .eq('id', conversationId);
}

export async function clearConversationState(conversationId: string) {
  await setConversationState(conversationId, null);
}
