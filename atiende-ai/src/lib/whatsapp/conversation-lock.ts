// ─────────────────────────────────────────────────────────────────────────────
// Conversation lock — Redis NX SET EX para serializar el procesamiento de
// mensajes por (tenantId, customerPhone).
//
// Sin esto, dos webhooks concurrentes del mismo paciente pueden disparar dos
// pipelines en paralelo y crear citas duplicadas (el `hasConflict` check
// no captura cuando ambos INSERT corren al mismo tiempo).
// ─────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null; // fail-open en CI/dev sin Redis
  _redis = new Redis({ url, token });
  return _redis;
}

const LOCK_TTL_SECONDS = 30; // safety release — pipeline normal tarda <10s

function key(tenantId: string, phone: string): string {
  return `lock:conv:${tenantId}:${phone}`;
}

/**
 * Intenta tomar el lock para esta conversación. Devuelve:
 *  - { acquired: true, token } si lo obtuvo (DEBES llamar release(token) después).
 *  - { acquired: false } si otro proceso ya lo tiene.
 */
export async function acquireConversationLock(
  tenantId: string,
  phone: string,
): Promise<{ acquired: boolean; token?: string }> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const redis = getRedis();
  if (!redis) return { acquired: true, token }; // fail-open
  try {
    const result = await redis.set(key(tenantId, phone), token, {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });
    if (result === 'OK') return { acquired: true, token };
    return { acquired: false };
  } catch (err) {
    // Fail-open: si Redis no está disponible (CI/dev sin UPSTASH_*),
    // permitimos continuar. La carrera de doble-booking ya está mitigada
    // por el UNIQUE constraint a nivel DB (uniq_appointment_slot).
    console.warn('[conv-lock] redis error, proceeding without lock:', err instanceof Error ? err.message : err);
    return { acquired: true, token };
  }
}

/**
 * Libera el lock SOLO si el token coincide (evita liberar el lock de otro
 * proceso si nuestro pipeline tardó más del TTL y el lock ya expiró).
 */
export async function releaseConversationLock(
  tenantId: string,
  phone: string,
  token: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const k = key(tenantId, phone);
  try {
    // Atomic check-and-delete via Lua script. The non-atomic GET+DEL
    // had a race: between GET and DEL another process could acquire
    // the lock, and our DEL would release THEIR lock.
    await redis.eval(
      `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
      [k],
      [token],
    );
  } catch {
    /* fail-open — TTL will release the lock */
  }
}
