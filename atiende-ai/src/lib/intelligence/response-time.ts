export function calculateResponseMetrics(messages: Array<{ direction: string; created_at: string }>) {
  const pairs: number[] = [];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].direction === 'outbound' && messages[i-1].direction === 'inbound') {
      const inTime = new Date(messages[i-1].created_at).getTime();
      const outTime = new Date(messages[i].created_at).getTime();
      pairs.push(outTime - inTime);
    }
  }

  if (pairs.length === 0) return { avg: 0, median: 0, p95: 0, count: 0 };

  pairs.sort((a, b) => a - b);
  const avg = pairs.reduce((s, v) => s + v, 0) / pairs.length;
  const median = pairs[Math.floor(pairs.length / 2)];
  const p95 = pairs[Math.floor(pairs.length * 0.95)];

  return { avg: Math.round(avg), median: Math.round(median), p95: Math.round(p95), count: pairs.length };
}
