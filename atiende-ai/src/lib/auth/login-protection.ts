// ═════════════════════════════════════════════════════════════════════════════
// LOGIN PROTECTION — rate-limit + lockout + progressive delay
//
// Tracks failed login attempts per email+IP in Redis. After MAX_ATTEMPTS
// failures within the window, the account is locked for LOCKOUT_SECONDS.
// Progressive delay adds artificial latency on each failure to slow brute
// force even within the attempt window.
//
// MFA (TOTP) is handled by Supabase Auth's built-in MFA factors — this
// module only handles the pre-auth brute-force protection layer.
// ═════════════════════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis({ url: process.env.UPSTASH_REDIS_URL, token: process.env.UPSTASH_REDIS_TOKEN || '' })
  : null;

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes
const WINDOW_SECONDS = 900;

function attemptsKey(email: string, ip: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return `login_attempts:${normalizedEmail}:${ip}`;
}

function lockoutKey(email: string): string {
  return `login_lockout:${email.toLowerCase().trim()}`;
}

export interface LoginCheckResult {
  allowed: boolean;
  attemptsRemaining: number;
  lockedUntil?: number; // epoch ms
  delayMs: number;
}

export async function checkLoginAllowed(
  email: string,
  ip: string,
): Promise<LoginCheckResult> {
  if (!redis) {
    return { allowed: true, attemptsRemaining: MAX_ATTEMPTS, delayMs: 0 };
  }

  try {
    const isLocked = await redis.get<string>(lockoutKey(email));
    if (isLocked) {
      const ttl = await redis.ttl(lockoutKey(email));
      return {
        allowed: false,
        attemptsRemaining: 0,
        lockedUntil: Date.now() + ttl * 1000,
        delayMs: 0,
      };
    }

    const key = attemptsKey(email, ip);
    const attempts = (await redis.get<number>(key)) ?? 0;
    const remaining = Math.max(0, MAX_ATTEMPTS - attempts);

    // Progressive delay: 0s, 1s, 2s, 4s, 8s
    const delayMs = attempts > 0 ? Math.min(8000, 1000 * Math.pow(2, attempts - 1)) : 0;

    return {
      allowed: remaining > 0,
      attemptsRemaining: remaining,
      delayMs,
    };
  } catch (err) {
    logger.warn('[login-protection] Redis error on check — fail-open', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, attemptsRemaining: MAX_ATTEMPTS, delayMs: 0 };
  }
}

export async function recordFailedLogin(email: string, ip: string): Promise<void> {
  if (!redis) return;

  try {
    const key = attemptsKey(email, ip);
    const attempts = await redis.incr(key);

    if (attempts === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (attempts >= MAX_ATTEMPTS) {
      await redis.set(lockoutKey(email), '1', { ex: LOCKOUT_SECONDS });
      logger.warn('[login-protection] account locked after max attempts', {
        email: email.replace(/(.{3}).*(@.*)/, '$1***$2'),
        ip,
        attempts,
      });
    }
  } catch (err) {
    logger.warn('[login-protection] Redis error on record — non-fatal', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function clearLoginAttempts(email: string, ip: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(attemptsKey(email, ip));
    await redis.del(lockoutKey(email));
  } catch {
    // Non-fatal
  }
}
