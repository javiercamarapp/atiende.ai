import { supabaseAdmin } from '@/lib/supabase/admin';

export enum ConversationStateEnum {
  AWAITING_APPOINTMENT_DATE = 'awaiting_appointment_date',
  AWAITING_MODIFY_DATE = 'awaiting_modify_date',
  AWAITING_ORDER_CONFIRMATION = 'awaiting_order_confirmation',
  AWAITING_RESERVATION_DETAILS = 'awaiting_reservation_details',
  // Phase 3 — outbound worker flows que esperan una respuesta inbound.
  // Cuando el bot manda un survey/recordatorio de confirmación, el tool
  // correspondiente setea este state con el appointment_id en el context
  // para que el siguiente mensaje del paciente se rutee al sub-agente
  // correcto (encuesta / no-show) en lugar de caer en el default `agenda`.
  AWAITING_SURVEY_RESPONSE = 'awaiting_survey_response',
  AWAITING_APPOINTMENT_CONFIRMATION = 'awaiting_appointment_confirmation',
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
 * Atomically writes conversation state into the `metadata` JSONB column
 * via a Supabase RPC that uses `jsonb_set`, avoiding read-modify-write
 * race conditions when multiple messages arrive concurrently.
 */
export async function setConversationState(
  conversationId: string,
  state: ConversationState,
  context?: Record<string, unknown>
) {
  await supabaseAdmin.rpc('set_conversation_state', {
    p_conversation_id: conversationId,
    p_state: state,
    p_context: context ?? {},
  });
}

export async function clearConversationState(conversationId: string) {
  await setConversationState(conversationId, null);
}
