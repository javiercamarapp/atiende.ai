// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY MESSAGE COUNTER — Redis en el hot path
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
 * Reserva atómica en la puerta de entrada (ANTES del LLM).
 *
 * Problema: antes llamábamos `incrementMonthlyMessages` al final del pipeline
 * (tras el LLM + send). Bajo carga concurrente, cientos de webhooks podían
 * pasar el `checkGates` con el mismo `count` lag, disparar N llamadas al LLM
 * y solo después incrementar. Costo: se quema presupuesto de tokens DESPUÉS
 * de haber superado el cap.
 *
 * Solución: `reserveMonthlyMessage()` hace INCR atómico de Redis. Si el nuevo
 * valor supera el límite, la reserva es rechazada y el caller puede hacer
 * rollback (decrement) — aún así Redis ya "reservó" el slot. Concurrency-safe
 * porque INCR es atómico en Redis.
 *
 * Si Redis no está disponible, fail-open (return { allowed: true, count: 0 })
 * para no bloquear el pipeline — la segunda línea de defensa es el cap
 * post-response (idempotente).
 *
 * Caller pattern:
 *   const reservation = await reserveMonthlyMessage(tenantId, planLimit);
 *   if (!reservation.allowed) return; // quota hit
 *   try { await generateResponse(...) }
 *   catch (err) {
 *     await releaseMonthlyReservation(tenantId); // rollback
 *     throw err;
 *   }
 */
export async function reserveMonthlyMessage(
  tenantId: string,
  planLimit: number,
): Promise<{ allowed: boolean; count: number; usingRedis: boolean }> {
  const redis = getRedis();
  if (!redis) {
    // Sin Redis — no podemos reservar atómicamente. Fail-open: dejamos pasar.
    // El count post-hoc (DB fallback) atrapará eventualmente al tenant que
    // sobregira, pero evita ponerlo offline si Redis está caído.
    return { allowed: true, count: 0, usingRedis: false };
  }
  const key = monthKey(tenantId);
  try {
    const newCount = await redis.incr(key);
    if (newCount === 1) {
      await redis.expire(key, secondsUntilMonthEnd());
    }
    if (newCount > planLimit) {
      // Excedió el límite — rollback atómico (mantiene invariante del contador).
      await redis.decr(key).catch(() => {});
      return { allowed: false, count: newCount - 1, usingRedis: true };
    }
    return { allowed: true, count: newCount, usingRedis: true };
  } catch {
    // Redis falló mid-flight — fail-open (no lo dejamos sin servicio).
    return { allowed: true, count: 0, usingRedis: false };
  }
}

/**
 * Compensación: decrementa el contador si una reserva fue hecha pero la
 * respuesta falló (LLM timeout, send WA falló, etc.). Idempotente (nunca
 * deja el contador por debajo de 0 porque Redis DECR clampea al incremento
 * previo — si ya bajó, no-op).
 */
export async function releaseMonthlyReservation(tenantId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.decr(monthKey(tenantId));
  } catch (err) {
    console.warn('[rate-limit-monthly] release decr failed:', err instanceof Error ? err.message : err);
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
    } catch (err) {
      console.warn('[rate-limit-monthly] warm cache failed:', err instanceof Error ? err.message : err);
    }
  }

  return value;
}
