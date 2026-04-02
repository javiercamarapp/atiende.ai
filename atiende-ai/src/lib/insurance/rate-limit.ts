// ═══════════════════════════════════════════════════════════
// MODULO DE SEGUROS AGENTICO — Rate Limiter
// Sliding window rate limiter backed by Upstash Redis
// ═══════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis'
import { logInsuranceError } from './logger'

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

/**
 * Simple sliding window rate limiter using Redis sorted sets.
 *
 * @param identifier - Unique key for the caller (e.g. user ID or IP)
 * @param limit      - Maximum number of requests allowed in the window
 * @param windowMs   - Window size in milliseconds
 * @returns true if the request is allowed, false if rate-limited
 */
export async function checkInsuranceRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const redis = getRedis()
  const key = `ins:rl:${identifier}`
  const now = Date.now()
  const windowStart = now - windowMs

  try {
    // Remove entries older than the window, add current request, and count
    const pipeline = redis.pipeline()
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 8)}` })
    pipeline.zcard(key)
    pipeline.expire(key, Math.ceil(windowMs / 1000))

    const results = await pipeline.exec()
    const count = results[2] as number

    return count <= limit
  } catch (err) {
    logInsuranceError(err, { context: 'checkInsuranceRateLimit', identifier })
    console.warn('[rate-limit] Redis error — failing closed (denying request)', { identifier })
    // On Redis error, deny the request (fail closed)
    return false
  }
}
