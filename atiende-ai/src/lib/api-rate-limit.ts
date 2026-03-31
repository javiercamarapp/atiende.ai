import { Redis } from '@upstash/redis';

const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis({ url: process.env.UPSTASH_REDIS_URL, token: process.env.UPSTASH_REDIS_TOKEN || '' })
  : null;

export async function checkApiRateLimit(identifier: string, limit = 30, window = 60): Promise<boolean> {
  if (!redis) return false;
  try {
    const key = `api_rate:${identifier}`;
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, window);
    return current > limit;
  } catch {
    return false;
  }
}
