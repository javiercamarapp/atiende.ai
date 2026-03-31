export interface MessageRecord {
  direction: 'inbound' | 'outbound';
  created_at: string;
}

/**
 * Calculate average response time in ms for outbound messages
 * following inbound messages.
 */
export function calculateAvgResponseTime(messages: MessageRecord[]): number {
  if (!messages.length) return 0;

  let totalMs = 0;
  let pairs = 0;

  for (let i = 1; i < messages.length; i++) {
    if (messages[i - 1].direction === 'inbound' && messages[i].direction === 'outbound') {
      const diff = new Date(messages[i].created_at).getTime() - new Date(messages[i - 1].created_at).getTime();
      if (diff > 0) {
        totalMs += diff;
        pairs++;
      }
    }
  }

  return pairs > 0 ? Math.round(totalMs / pairs) : 0;
}
