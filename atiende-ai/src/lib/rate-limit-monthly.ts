// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY MESSAGE COUNTER — Redis en el hot path (AUDIT R12 BUG-003)
//
// Antes: processor.ts hacía `SELECT count(*) FROM messages` por CADA webhook
// para validar el límite mensual del plan. Esto castigaba latencia +
// saturaba connection pool a escala.
//
// Ahora: counter en Redis (Upstash) con TTL al final del mes. Fallback a DB
// si Redis no está disponible (no rompe el pipeline). El contador se
// incrementa por cada outbound bot message en vez de contar todo cada vez.
// ═════════════════════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/supabase/admin';

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function monthKey(tenantId: string): string {
  const yearMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
  return `msg_monthly:${tenantId}:${yearMonth}`;
}

/** Segundos hasta medianoche UTC del 1er día del próximo mes. */
function secondsUntilMonthEnd(): number {
  const now = new Date();
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(60, Math.floor((nextMonthStart.getTime() - now.getTime()) / 1000));
}

/**
 * Incrementa el contador del mes. Llamar DESPUÉS de enviar cada mensaje
 * outbound del bot. Fail-open: si Redis falla, no rompe.
 */
export async function incrementMonthlyMessages(tenantId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0; // sin Redis, skip (DB fallback en getter)
  const key = monthKey(tenantId);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilMonthEnd());
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Devuelve el count actual del mes. Prefiere Redis; si no existe, fallback
 * a COUNT en Supabase (one-shot; se cachea en Redis para próximos checks).
 */
export async function getMonthlyMessageCount(tenantId: string): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<number>(monthKey(tenantId));
      if (cached !== null && cached !== undefined) return Number(cached);
    } catch { /* fallback below */ }
  }

  // Fallback: count real desde DB (solo cuando Redis no tiene valor)
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound')
    .eq('sender_type', 'bot')
    .gte('created_at', monthStart.toISOString());

  const value = count ?? 0;

  // Warm cache en Redis para siguientes checks del mes
  if (redis && value > 0) {
    try {
      await redis.set(monthKey(tenantId), value, { ex: secondsUntilMonthEnd() });
    } catch { /* no-op */ }
  }

  return value;
}
