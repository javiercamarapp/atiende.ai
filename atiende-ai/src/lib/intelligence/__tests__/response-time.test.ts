import { describe, it, expect } from 'vitest';
import { calculateAvgResponseTime, type MessageRecord } from '../response-time';

describe('calculateAvgResponseTime', () => {
  it('alternating in/out messages calculates average correctly', () => {
    const msgs: MessageRecord[] = [
      { direction: 'inbound', created_at: '2025-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2025-01-01T10:00:05Z' },
      { direction: 'inbound', created_at: '2025-01-01T10:01:00Z' },
      { direction: 'outbound', created_at: '2025-01-01T10:01:10Z' },
    ];
    const avg = calculateAvgResponseTime(msgs);
    expect(avg).toBe(7500);
  });

  it('all inbound messages returns 0', () => {
    const msgs: MessageRecord[] = [
      { direction: 'inbound', created_at: '2025-01-01T10:00:00Z' },
      { direction: 'inbound', created_at: '2025-01-01T10:01:00Z' },
      { direction: 'inbound', created_at: '2025-01-01T10:02:00Z' },
    ];
    expect(calculateAvgResponseTime(msgs)).toBe(0);
  });

  it('empty array returns 0', () => {
    expect(calculateAvgResponseTime([])).toBe(0);
  });

  it('single inbound-outbound pair returns correct time diff', () => {
    const msgs: MessageRecord[] = [
      { direction: 'inbound', created_at: '2025-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2025-01-01T10:00:03Z' },
    ];
    expect(calculateAvgResponseTime(msgs)).toBe(3000);
  });

  it('ignores outbound-outbound consecutive pairs', () => {
    const msgs: MessageRecord[] = [
      { direction: 'inbound', created_at: '2025-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2025-01-01T10:00:02Z' },
      { direction: 'outbound', created_at: '2025-01-01T10:00:04Z' },
    ];
    expect(calculateAvgResponseTime(msgs)).toBe(2000);
  });
});
