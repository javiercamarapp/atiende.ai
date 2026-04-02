import { Redis } from '@upstash/redis'
import type { Tenant } from '@/types'

export type TenantConfig = Tenant

// ---------------------------------------------------------------------------
// Redis client (nullable – falls back to in-memory when unavailable)
// ---------------------------------------------------------------------------
let redis: Redis | null = null
try {
  if (process.env.UPSTASH_REDIS_URL) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    })
  }
} catch {
  redis = null
}

// ---------------------------------------------------------------------------
// In-memory fallback (5-minute TTL)
// ---------------------------------------------------------------------------
const MEM_TTL_MS = 5 * 60 * 1000
const memCache = new Map<string, { data: TenantConfig; expiresAt: number }>()

function memGet(key: string): TenantConfig | null {
  const entry = memCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key)
    return null
  }
  return entry.data
}

function memSet(key: string, data: TenantConfig): void {
  memCache.set(key, { data, expiresAt: Date.now() + MEM_TTL_MS })
}

function memDel(key: string): void {
  memCache.delete(key)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const REDIS_TTL_SECONDS = 60 * 60 // 1 hour

function cacheKey(tenantId: string): string {
  return `tenant_config:${tenantId}`
}

/**
 * Retrieve cached tenant config.
 * Tries Redis first; falls back to in-memory cache when Redis is unavailable.
 */
export async function getCachedTenantConfig(tenantId: string): Promise<TenantConfig | null> {
  const key = cacheKey(tenantId)

  if (redis) {
    try {
      const cached = await redis.get<TenantConfig>(key)
      return cached ?? null
    } catch {
      // Redis unreachable – fall through to in-memory
    }
  }

  return memGet(key)
}

/**
 * Store tenant config in cache.
 * Writes to Redis (1-hour TTL) with an in-memory fallback (5-minute TTL).
 */
export async function setCachedTenantConfig(tenantId: string, config: TenantConfig): Promise<void> {
  const key = cacheKey(tenantId)

  // Always keep an in-memory copy as fallback
  memSet(key, config)

  if (redis) {
    try {
      await redis.set(key, config, { ex: REDIS_TTL_SECONDS })
    } catch {
      // Swallow – in-memory fallback is already populated
    }
  }
}

/**
 * Invalidate tenant config from all cache layers.
 */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  const key = cacheKey(tenantId)
  memDel(key)

  if (redis) {
    try {
      await redis.del(key)
    } catch {
      // Best-effort
    }
  }
}
