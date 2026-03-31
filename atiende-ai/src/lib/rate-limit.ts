import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function checkRateLimit(phone: string): Promise<{ allowed: boolean }> {
  const key = `rl:wa:${phone}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 60);
  return { allowed: current <= 3 };
}

export async function checkTenantLimit(tenantId: string, plan: string): Promise<{ allowed: boolean }> {
  const limits: Record<string, number> = { free_trial: 50, basic: 200, pro: 1000, premium: 10000 };
  const key = `rl:tenant:${tenantId}:${new Date().toISOString().split('T')[0]}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 86400);
  return { allowed: current <= (limits[plan] || 50) };
}
