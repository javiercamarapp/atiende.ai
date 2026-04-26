import {
  classifyIntent,
  classifyIntentWithConfidence,
  type ClassificationResult,
} from '@/lib/llm/classifier';

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
 * Resolves the intent for an incoming message including confidence.
 * If the conversation has active state, returns the mapped intent with
 * confidence=1.0 (state machine override is determinístico).
 * Otherwise, llama al classifier con confidence + reclasificación adaptativa.
 */
export async function resolveIntentWithConfidence(
  content: string,
  conversationId: string,
): Promise<ClassificationResult> {
  try {
    const { getConversationState, clearConversationState } = await import(
      '@/lib/actions/state-machine'
    );
    const convState = await getConversationState(conversationId);

    if (convState.state) {
      const overrideIntent = STATE_INTENT_MAP[convState.state] ?? null;
      await clearConversationState(conversationId);
      if (overrideIntent) {
        return {
          // Cast: STATE_INTENT_MAP usa strings que coinciden con ValidIntent
          // por construcción (mantener sincronizado con classifier.ts).
          intent: overrideIntent as ClassificationResult['intent'],
          confidence: 1.0,
          source: 'fast_path',
        };
      }
    }
  } catch {
    /* best effort */
  }

  return classifyIntentWithConfidence(content);
}

/**
 * Wrapper retro-compatible: callers existentes que solo quieren el intent
 * siguen funcionando sin cambios. El nuevo path con confidence es opt-in
 * vía `resolveIntentWithConfidence`.
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
