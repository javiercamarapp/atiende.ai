// ═════════════════════════════════════════════════════════════════════════════
// FAQ response cache
//
// El fast-path de FAQ (handleFAQ) ya evita el LLM. Pero a escala (100+
// mensajes/día por tenant) las queries Supabase se repiten constantemente:
// el mismo paciente pregunta el horario 3 veces en el mismo día, cada
// pregunta es 1 DB roundtrip (~30-80ms).
//
// Esta cache Redis (5 min TTL) sirve respuestas FAQ ya computadas con la
// misma llave `faq:{tenantId}:{intent}`. Si Redis miss o falla, fall-through
// a la función original (behavior intacto).
//
// Por qué 5 min:
//   - Los datos FAQ (horario, dirección, precios) cambian rarísimo.
//   - Si el dueño edita en el dashboard, el valor cacheado stale dura max
//     5 min — aceptable.
//   - Más TTL = más stale risk. Menos TTL = menos hit rate.
//
// Por qué NO cacheamos respuestas LLM en general:
//   - Respuestas del orchestrator incluyen contexto temporal ("mañana es
//     miércoles") que se vuelve incorrecto.
//   - System prompts + tools + history hacen que el hit rate real sea <5%.
//   - Cachear tool-calling sería peligroso (repetir book_appointment).
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

const TTL_SECONDS = 300; // 5 min

export type FAQIntent = 'HOURS' | 'LOCATION' | 'PRICE' | 'INSURANCE';

function key(tenantId: string, intent: FAQIntent): string {
  return `faq:${tenantId}:${intent}`;
}

/**
 * Intenta servir la respuesta desde cache. Retorna null si miss o Redis no
 * disponible — el caller debe llamar al handler real y luego `setCached`.
 */
export async function getCached(
  tenantId: string,
  intent: FAQIntent,
): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<string>(key(tenantId, intent));
  } catch (err) {
    console.warn('[faq-cache] redis get error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Guarda la respuesta en cache con TTL de 5 min. Silencioso en error —
 * la cache es defense-in-depth, no el path principal.
 */
export async function setCached(
  tenantId: string,
  intent: FAQIntent,
  value: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key(tenantId, intent), value, { ex: TTL_SECONDS });
  } catch (err) {
    console.warn('[faq-cache] redis set error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Invalida la cache de un tenant (todos los intents). Llamar desde el
 * dashboard cuando el dueño actualiza horarios/dirección/precios.
 */
export async function invalidateTenant(tenantId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const intents: FAQIntent[] = ['HOURS', 'LOCATION', 'PRICE', 'INSURANCE'];
    await Promise.all(intents.map((i) => redis.del(key(tenantId, i))));
  } catch (err) {
    console.warn('[faq-cache] invalidate error:', err instanceof Error ? err.message : err);
  }
}
