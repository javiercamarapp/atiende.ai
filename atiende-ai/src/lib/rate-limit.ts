// Rate limiter with Redis primary + in-memory fallback. Fail-closed on errors.
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Redis client (nullable – falls back to in-memory when unavailable)
// ---------------------------------------------------------------------------
let redis: Redis | null = null;
let warnedFallback = false;

function warnFallbackOnce(reason: string): void {
  if (warnedFallback) return;
  warnedFallback = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[rate-limit] Redis unavailable (${reason}); using in-memory fallback. ` +
      'Counters will not be shared across processes.',
  );
}

try {
  if (process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN,
    });
  } else {
    warnFallbackOnce('missing UPSTASH_REDIS_URL or UPSTASH_REDIS_TOKEN');
  }
} catch (err) {
  redis = null;
  warnFallbackOnce(err instanceof Error ? err.message : 'init failed');
}

// ---------------------------------------------------------------------------
// In-memory fallback: bounded fixed-window counter (matches Redis semantics)
// ---------------------------------------------------------------------------
type Counter = { count: number; resetAt: number };

const MAX_KEYS = 10_000;
// Insertion-ordered Map gives us cheap LRU-by-insertion eviction.
const memCounters = new Map<string, Counter>();

function memTouch(key: string): void {
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  const entry = memCounters.get(key);
  if (entry) {
    memCounters.delete(key);
    memCounters.set(key, entry);
  }
}

function memEvictIfNeeded(): void {
  while (memCounters.size > MAX_KEYS) {
    const oldestKey = memCounters.keys().next().value;
    if (oldestKey === undefined) break;
    memCounters.delete(oldestKey);
  }
}

/**
 * Increment an in-memory fixed-window counter.
 * - Lazy expiry: if `resetAt` has passed, the window restarts.
 * - Bounded: at most MAX_KEYS entries; oldest evicted first.
 *
 * Returns the new count and the absolute reset timestamp (ms).
 */
function memIncr(key: string, windowSec: number): Counter {
  const now = Date.now();
  let entry = memCounters.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + windowSec * 1000 };
    memCounters.delete(key); // ensure re-insertion to tail
    memCounters.set(key, entry);
    memEvictIfNeeded();
    return entry;
  }

  entry.count += 1;
  memTouch(key);
  return entry;
}

function memTtlSeconds(key: string): number {
  const entry = memCounters.get(key);
  if (!entry) return 0;
  const remaining = Math.ceil((entry.resetAt - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

// ---------------------------------------------------------------------------
// Internal: shared incr-with-expire that prefers Redis, falls back to memory.
// Never throws.
// ---------------------------------------------------------------------------
async function incrWithExpire(
  key: string,
  windowSec: number,
): Promise<{ count: number; ttlSec: number }> {
  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSec);
      }
      let ttl = windowSec;
      try {
        const t = await redis.ttl(key);
        if (typeof t === 'number' && t > 0) ttl = t;
      } catch {
        // ignore ttl failures – fall back to full window
      }
      return { count: current, ttlSec: ttl };
    } catch (err) {
      warnFallbackOnce(err instanceof Error ? err.message : 'redis error');
      // fall through to in-memory
    }
  }

  const entry = memIncr(key, windowSec);
  return { count: entry.count, ttlSec: memTtlSeconds(key) };
}

// ---------------------------------------------------------------------------
// Public API – signatures preserved exactly so callers don't change.
// All functions are fail-closed: they NEVER throw and always return a result.
// ---------------------------------------------------------------------------

/**
 * Per-phone rate limit: max 3 messages per 60 seconds.
 */
export async function checkRateLimit(phone: string): Promise<{ allowed: boolean }> {
  try {
    const key = `rl:wa:${phone}`;
    const { count } = await incrWithExpire(key, 60);
    return { allowed: count <= 3 };
  } catch {
    // Absolute last-resort guard – should be unreachable.
    return { allowed: true };
  }
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
 * Uses a fixed-window counter keyed to the current UTC hour.
 *
 * @returns `allowed` – whether the message should be processed.
 *          `retryAfter` – seconds until the current window resets (only present when blocked).
 */
export async function checkTenantRateLimit(
  tenantId: string,
  plan: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free_trial;
    const hourKey = new Date().toISOString().slice(0, 13); // e.g. "2026-04-02T18"
    const key = `rl:tenant:${tenantId}:${hourKey}`;

    const { count, ttlSec } = await incrWithExpire(key, HOUR_SECONDS);

    if (count <= limit) {
      return { allowed: true };
    }
    return { allowed: false, retryAfter: ttlSec > 0 ? ttlSec : HOUR_SECONDS };
  } catch {
    return { allowed: true };
  }
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
  try {
    const key = `rl:llm:${tenantId}`;
    const { count, ttlSec } = await incrWithExpire(key, LLM_WINDOW_SECONDS);

    if (count <= LLM_MAX_CALLS) {
      return { allowed: true };
    }
    return { allowed: false, retryAfter: ttlSec > 0 ? ttlSec : LLM_WINDOW_SECONDS };
  } catch {
    return { allowed: true };
  }
}

/**
 * @deprecated Use `checkTenantRateLimit` instead (hourly window with retryAfter).
 */
export async function checkTenantLimit(
  tenantId: string,
  plan: string,
): Promise<{ allowed: boolean }> {
  const { allowed } = await checkTenantRateLimit(tenantId, plan);
  return { allowed };
}
