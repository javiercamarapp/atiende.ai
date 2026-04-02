import { classifyIntent } from '@/lib/llm/classifier';

/**
 * State-to-intent mapping for multi-turn conversation flows.
 * When a conversation has active state, we skip the LLM classifier
 * and directly map to the expected intent.
 */
const STATE_INTENT_MAP: Record<string, string> = {
  awaiting_appointment_date: 'APPOINTMENT_NEW',
  awaiting_modify_date: 'APPOINTMENT_MODIFY_CONFIRM',
  awaiting_order_confirmation: 'ORDER_CONFIRM',
  awaiting_reservation_details: 'RESERVATION',
};

/**
 * Resolves the intent for an incoming message.
 * If the conversation has active state, returns the mapped intent and clears state.
 * Otherwise, falls through to the LLM classifier.
 */
export async function resolveIntent(
  content: string,
  conversationId: string,
): Promise<string> {
  try {
    const { getConversationState, clearConversationState } = await import(
      '@/lib/actions/state-machine'
    );
    const convState = await getConversationState(conversationId);

    if (convState.state) {
      const overrideIntent = STATE_INTENT_MAP[convState.state] ?? null;
      await clearConversationState(conversationId);
      if (overrideIntent) return overrideIntent;
    }
  } catch {
    /* best effort */
  }

  return classifyIntent(content);
}
