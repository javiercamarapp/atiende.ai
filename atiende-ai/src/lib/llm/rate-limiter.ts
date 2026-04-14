// ═════════════════════════════════════════════════════════════════════════════
// OpenRouter rate limiter — sliding window por tenant + global
// Previene que un tenant con bucle infinito (bug) o ataque DoS consuma el
// presupuesto de OpenRouter de todos los demás.
// ═════════════════════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  // Supabase/Upstash no siempre disponibles en dev/test — lazy init con guardia
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const TENANT_WINDOW_SECONDS = 60;
const TENANT_MAX_PER_MINUTE = 60;

const GLOBAL_WINDOW_SECONDS = 60;
const GLOBAL_MAX_PER_MINUTE = 500;

export class RateLimitError extends Error {
  constructor(public readonly scope: 'tenant' | 'global', public readonly retryAfter: number) {
    super(`Rate limit exceeded (${scope}). Retry in ${retryAfter}s.`);
    this.name = 'RateLimitError';
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // segundos
}

/**
 * Sliding-window check contra Redis. Si Redis no está disponible, permite
 * (fail-open) — el rate limiting es defense-in-depth, no el único control.
 */
async function checkBucket(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: limit, resetIn: windowSeconds };

  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, windowSeconds);
  const ttl = current === 1 ? windowSeconds : await redis.ttl(key);
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetIn: ttl > 0 ? ttl : windowSeconds,
  };
}

/**
 * Verifica ambos buckets (tenant + global). Si alguno excede, lanza
 * RateLimitError. Llama esta función ANTES de cada llamada a OpenRouter.
 */
export async function checkOpenRouterRateLimit(tenantId: string): Promise<void> {
  const [tenant, global] = await Promise.all([
    checkBucket(`or:tenant:${tenantId}`, TENANT_MAX_PER_MINUTE, TENANT_WINDOW_SECONDS),
    checkBucket('or:global', GLOBAL_MAX_PER_MINUTE, GLOBAL_WINDOW_SECONDS),
  ]);

  if (!tenant.allowed) throw new RateLimitError('tenant', tenant.resetIn);
  if (!global.allowed) throw new RateLimitError('global', global.resetIn);
}

/** Mensaje amigable para el paciente cuando hay rate limit. */
export const RATE_LIMIT_USER_MESSAGE =
  'Estamos procesando muchas solicitudes en este momento. Un momento por favor, le respondo enseguida.';
