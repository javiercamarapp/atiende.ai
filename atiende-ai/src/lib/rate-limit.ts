import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

/**
 * Per-phone rate limit: max 3 messages per 60 seconds.
 */
export async function checkRateLimit(phone: string): Promise<{ allowed: boolean }> {
  const key = `rl:wa:${phone}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 60);
  return { allowed: current <= 3 };
}

// ---------------------------------------------------------------------------
// Per-tenant hourly rate limiting
// ---------------------------------------------------------------------------

const HOUR_SECONDS = 3600;

const PLAN_LIMITS: Record<string, number> = {
  free_trial: 50,
  basic: 200,
  pro: 1000,
  premium: 5000,
};

/**
 * Per-tenant rate limit based on plan.
 * Uses a sliding-window counter keyed to the current UTC hour.
 *
 * @returns `allowed` – whether the message should be processed.
 *          `retryAfter` – seconds until the current window resets (only present when blocked).
 */
export async function checkTenantRateLimit(
  tenantId: string,
  plan: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free_trial;
  const hourKey = new Date().toISOString().slice(0, 13); // e.g. "2026-04-02T18"
  const key = `rl:tenant:${tenantId}:${hourKey}`;

  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, HOUR_SECONDS);

  if (current <= limit) {
    return { allowed: true };
  }

  // Compute retryAfter from remaining TTL on the key
  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfter: ttl > 0 ? ttl : HOUR_SECONDS };
}

/**
 * @deprecated Use `checkTenantRateLimit` instead (hourly window with retryAfter).
 */
export async function checkTenantLimit(tenantId: string, plan: string): Promise<{ allowed: boolean }> {
  const { allowed } = await checkTenantRateLimit(tenantId, plan);
  return { allowed };
}
