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
 * Intenta tomar el lock para esta conversación. Si está tomado por otro
 * proceso, espera hasta `maxWaitMs` haciendo poll cada `pollIntervalMs`
 * y reintenta. Esto evita perder el mensaje #N+1 cuando llega mientras el
 * pipeline #N todavía corre — antes el throw inmediato + waitUntil.catch
 * descartaba mensajes en silencio (markAsRead nunca corría → en WhatsApp
 * el mensaje quedaba sin doble-check azul).
 *
 * Pipeline normal tarda <15s. Default maxWaitMs=15000ms cubre el caso
 * común; si excede (Grok colgado, fallback, etc) damos { acquired: false }
 * para que el caller decida (típicamente: log + 500 → QStash retry).
 *
 * Devuelve:
 *  - { acquired: true, token } si lo obtuvo (DEBES llamar release(token) después).
 *  - { acquired: false } si tras esperar maxWaitMs sigue tomado.
 */
export async function acquireConversationLock(
  tenantId: string,
  phone: string,
  opts: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<{ acquired: boolean; token?: string }> {
  const maxWaitMs = opts.maxWaitMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const deadline = Date.now() + maxWaitMs;

  const redis = getRedis();
  if (!redis) {
    // fail-open: sin Redis (CI/dev) no hay serialización; el UNIQUE
    // constraint a nivel DB sigue protegiendo contra doble-booking.
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { acquired: true, token };
  }

  // Loop: SET NX EX → si OK, lock nuestro. Si no, esperar y reintentar.
  while (true) {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await redis.set(key(tenantId, phone), token, {
        nx: true,
        ex: LOCK_TTL_SECONDS,
      });
      if (result === 'OK') return { acquired: true, token };
    } catch (err) {
      // Redis flaky → fail-open en lugar de perder el mensaje. UNIQUE
      // constraint protege contra carreras a nivel DB.
      console.warn('[conv-lock] redis error, proceeding without lock:', err instanceof Error ? err.message : err);
      return { acquired: true, token };
    }

    // Lock tomado por otro pipeline. Esperar y reintentar mientras haya budget.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { acquired: false };
    await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, remaining)));
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
