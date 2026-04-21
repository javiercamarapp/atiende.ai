// ═════════════════════════════════════════════════════════════════════════════
// OpenRouter circuit breaker (AUDIT P2 item 7)
//
// Cuando OpenRouter está caído (incidente upstream) o degrada (timeout
// sostenido), sin circuit breaker TODOS los requests siguen llegando:
//
//   - Cada uno consume el budget de 10s del primary + 10s del fallback.
//   - El rate-limiter Redis incrementa contadores innecesariamente.
//   - El paciente espera 20s para recibir un mensaje genérico de fallback.
//   - Si QStash está activo, reintentos se apilan y saturan el worker.
//
// Breaker clásico con 3 estados:
//
//   CLOSED   — requests fluyen normalmente, contamos fallas consecutivas.
//   OPEN     — tras N fallas consecutivas, bloqueamos requests por M segundos.
//              Respondemos instantáneo con "servicio caído, reintente".
//   HALF_OPEN — tras el cooloff, dejamos pasar 1 request de prueba. Si OK
//              → CLOSED; si falla → volvemos a OPEN.
//
// Estado vive en Redis (shared across instances serverless). Si Redis no
// responde, fail-open (permitimos el request) — el breaker es defense-in-
// depth, no el único control.
// ═════════════════════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const BREAKER_KEY = 'cb:openrouter';
const FAILURE_COUNT_KEY = 'cb:openrouter:failures';

/** Fallas consecutivas antes de abrir el breaker. 5 es conservador: un
 *  blip transitorio (2-3 fallas) no debe afectar al resto del tráfico. */
const FAILURE_THRESHOLD = 5;
/** Ventana para considerar fallas como consecutivas (segs). Tras 60s sin
 *  fallas, el contador se resetea. */
const FAILURE_WINDOW_SECONDS = 60;
/** Duración del estado OPEN antes de probar HALF_OPEN. 30s es un balance:
 *  suficiente para que incidentes upstream se resuelvan sin agregar latencia
 *  excesiva a un outage real. */
const OPEN_DURATION_SECONDS = 30;

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  constructor(public readonly retryAfter: number) {
    super(`OpenRouter circuit breaker OPEN — retry in ${retryAfter}s`);
    this.name = 'CircuitOpenError';
  }
}

export const CIRCUIT_OPEN_USER_MESSAGE =
  'Estamos teniendo un problema temporal con nuestro asistente. Por favor intente en 30 segundos o contáctenos directamente.';

/**
 * Chequea el estado del breaker. Si OPEN, lanza CircuitOpenError con
 * retryAfter. Si HALF_OPEN, deja pasar (el caller debe reportar éxito/falla).
 *
 * Semántica half-open simplificada: en Redis el breaker solo tiene OPEN
 * o nada. Cuando el key expira naturalmente (TTL llega a 0), la próxima
 * request es "half-open" de facto — si falla, recrea el OPEN; si succeeds,
 * el contador de fallas se resetea.
 */
export async function checkCircuit(): Promise<void> {
  const redis = getRedis();
  if (!redis) return; // fail-open sin Redis

  try {
    const state = await redis.get<string>(BREAKER_KEY);
    if (state === 'open') {
      const ttl = await redis.ttl(BREAKER_KEY);
      throw new CircuitOpenError(ttl > 0 ? ttl : OPEN_DURATION_SECONDS);
    }
  } catch (err) {
    if (err instanceof CircuitOpenError) throw err;
    // Redis failure → fail-open.
    console.warn('[circuit-breaker] redis error, fail-open:', err instanceof Error ? err.message : err);
  }
}

/**
 * Reporta una falla al breaker. Incrementa contador; si supera threshold
 * dentro de la ventana, abre el breaker.
 */
export async function reportFailure(reason: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    // AUDIT R19 #13: INCR + EXPIRE atómicos via Lua. El patrón previo dejaba
    // keys inmortales si el segundo request llegaba entre INCR y EXPIRE y el
    // primer EXPIRE fallaba.
    const count = (await redis.eval(
      "local v = redis.call('INCR', KEYS[1]); if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return v",
      [FAILURE_COUNT_KEY],
      [String(FAILURE_WINDOW_SECONDS)],
    )) as number;
    if (count >= FAILURE_THRESHOLD) {
      await redis.set(BREAKER_KEY, 'open', { ex: OPEN_DURATION_SECONDS });
      // Reset counter para que cuando el breaker cierre, empecemos limpio.
      await redis.del(FAILURE_COUNT_KEY);
      console.warn(
        `[circuit-breaker] OpenRouter breaker OPEN for ${OPEN_DURATION_SECONDS}s after ${count} failures. Last reason: ${reason}`,
      );
    }
  } catch (err) {
    console.warn('[circuit-breaker] reportFailure redis error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Reporta un éxito. Limpia el contador de fallas (un éxito resetea el track
 * de "fallas consecutivas"). Si el breaker estaba OPEN pero el TTL ya pasó
 * y esta request es la "half-open" de prueba, no tocamos BREAKER_KEY —
 * ya expiró naturalmente.
 */
export async function reportSuccess(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(FAILURE_COUNT_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Utility solo para tests / dashboard — leer el estado sin efectos.
 */
export async function getBreakerState(): Promise<BreakerState> {
  const redis = getRedis();
  if (!redis) return 'closed';
  try {
    const state = await redis.get<string>(BREAKER_KEY);
    if (state === 'open') return 'open';
    const failures = await redis.get<number>(FAILURE_COUNT_KEY);
    if (failures && failures > 0) return 'half_open';
    return 'closed';
  } catch {
    return 'closed';
  }
}
