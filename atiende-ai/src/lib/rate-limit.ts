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
 * SEC-4: además del límite por hora, ahora aplicamos:
 *   - Burst per-minute (1/10 del límite horario) para detectar floods
 *   - Cuenta de teléfonos únicos por hora (alerta a >50% del cap si
 *     hay >100 phones distintos — señal de DDoS con SIM virtuales).
 *
 * @returns `allowed` – whether the message should be processed.
 *          `retryAfter` – seconds until the current window resets (only present when blocked).
 *          `reason` – 'hourly' | 'burst' | undefined cuando está bloqueado.
 */
export async function checkTenantRateLimit(
  tenantId: string,
  plan: string,
  senderPhone?: string,
): Promise<{ allowed: boolean; retryAfter?: number; reason?: 'hourly' | 'burst' }> {
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free_trial;
  const hourKey = new Date().toISOString().slice(0, 13); // e.g. "2026-04-02T18"
  const key = `rl:tenant:${tenantId}:${hourKey}`;

  // Burst: 1/10 del cap horario en una ventana de 60s
  const burstCap = Math.max(10, Math.floor(limit / 10));
  const burstKey = `rl:tenant_burst:${tenantId}:${Math.floor(Date.now() / 60_000)}`;

  const [current, burst] = await Promise.all([
    redis.incr(key),
    redis.incr(burstKey),
  ]);
  if (current === 1) await redis.expire(key, HOUR_SECONDS);
  if (burst === 1) await redis.expire(burstKey, 60);

  if (burst > burstCap) {
    return { allowed: false, retryAfter: 60, reason: 'burst' };
  }

  if (current <= limit) {
    // Tracking de phones únicos para alertar de patrones DDoS (no bloquea)
    if (senderPhone) {
      const uniqKey = `rl:tenant_uniqphones:${tenantId}:${hourKey}`;
      try {
        await redis.sadd(uniqKey, senderPhone);
        await redis.expire(uniqKey, HOUR_SECONDS);
      } catch { /* best effort */ }
    }
    return { allowed: true };
  }

  // Compute retryAfter from remaining TTL on the key
  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfter: ttl > 0 ? ttl : HOUR_SECONDS, reason: 'hourly' };
}

// ---------------------------------------------------------------------------
// Per-tenant LLM call rate limiting (DDoS amplification prevention)
// ---------------------------------------------------------------------------

const LLM_WINDOW_SECONDS = 60;
const LLM_MAX_CALLS = 100;

/**
 * Per-tenant LLM rate limit: max 100 LLM calls per 60-second window.
 * Call this before every LLM invocation to prevent DDoS amplification.
 *
 * @returns `allowed` – whether the LLM call should proceed.
 *          `retryAfter` – seconds until the current window resets (only present when blocked).
 */
export async function checkLLMRateLimit(
  tenantId: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = `rl:llm:${tenantId}`;

  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, LLM_WINDOW_SECONDS);

  if (current <= LLM_MAX_CALLS) {
    return { allowed: true };
  }

  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfter: ttl > 0 ? ttl : LLM_WINDOW_SECONDS };
}

/**
 * @deprecated Use `checkTenantRateLimit` instead (hourly window with retryAfter).
 */
export async function checkTenantLimit(tenantId: string, plan: string): Promise<{ allowed: boolean }> {
  const { allowed } = await checkTenantRateLimit(tenantId, plan);
  return { allowed };
}
