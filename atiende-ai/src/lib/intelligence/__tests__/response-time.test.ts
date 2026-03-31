import { describe, it, expect } from 'vitest';
import { calculateResponseMetrics } from '../response-time';

describe('calculateResponseMetrics()', () => {
  it('calcula tiempo promedio de respuesta', () => {
    const messages = [
      { direction: 'inbound', created_at: '2026-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2026-01-01T10:00:05Z' }, // 5s
      { direction: 'inbound', created_at: '2026-01-01T10:01:00Z' },
      { direction: 'outbound', created_at: '2026-01-01T10:01:03Z' }, // 3s
    ];
    const metrics = calculateResponseMetrics(messages);
    expect(metrics.count).toBe(2);
    expect(metrics.avg).toBe(4000); // 4s average
    expect(metrics.median).toBeGreaterThan(0);
  });

  it('todos inbound → 0', () => {
    const messages = [
      { direction: 'inbound', created_at: '2026-01-01T10:00:00Z' },
      { direction: 'inbound', created_at: '2026-01-01T10:01:00Z' },
    ];
    const metrics = calculateResponseMetrics(messages);
    expect(metrics.count).toBe(0);
    expect(metrics.avg).toBe(0);
  });

  it('array vacío → 0', () => {
    const metrics = calculateResponseMetrics([]);
    expect(metrics.count).toBe(0);
    expect(metrics.avg).toBe(0);
    expect(metrics.median).toBe(0);
    expect(metrics.p95).toBe(0);
  });

  it('un solo par → valores correctos', () => {
    const messages = [
      { direction: 'inbound', created_at: '2026-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2026-01-01T10:00:02Z' }, // 2s
    ];
    const metrics = calculateResponseMetrics(messages);
    expect(metrics.count).toBe(1);
    expect(metrics.avg).toBe(2000);
  });

  it('p95 es mayor o igual al median', () => {
    const messages = [
      { direction: 'inbound', created_at: '2026-01-01T10:00:00Z' },
      { direction: 'outbound', created_at: '2026-01-01T10:00:01Z' },
      { direction: 'inbound', created_at: '2026-01-01T10:01:00Z' },
      { direction: 'outbound', created_at: '2026-01-01T10:01:10Z' },
    ];
    const metrics = calculateResponseMetrics(messages);
    expect(metrics.p95).toBeGreaterThanOrEqual(metrics.median);
  });
});
