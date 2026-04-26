// ═════════════════════════════════════════════════════════════════════════════
// METRICS — métricas estructuradas per-tenant
//
// Emite logs JSON estructurados que Vercel/Datadog/Grafana parsean auto.
// Diseñado para que el dashboard del dueño pueda mostrar en tiempo real:
//   - Mensajes/día
//   - Latencia LLM p50/p95
//   - Costo acumulado en tokens
//   - Tasa de confirmación de citas
//   - Alertas de overage
//
// Formato: 1 línea JSON por métrica. Vercel captura stdout.
// Para dashboard persistente: opcionalmente INSERT en `metrics` table.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { Redis } from '@upstash/redis';

export interface MetricEvent {
  name: string;
  value: number;
  unit?: 'ms' | 'usd' | 'mxn' | 'tokens' | 'count' | 'ratio';
  tenantId?: string;
  tags?: Record<string, string | number>;
}

/** Emite una métrica. Fire-and-forget (no bloquea hot path). */
export function emit(m: MetricEvent): void {
  const entry = {
    _type: 'metric',
    ts: new Date().toISOString(),
    name: m.name,
    value: m.value,
    unit: m.unit || 'count',
    tenant_id: m.tenantId || null,
    tags: m.tags || {},
  };
  // Structured log — Vercel/Datadog parsea JSON automáticamente
  console.log(JSON.stringify(entry));

  // Best-effort persist (solo si la feature flag está activa — default OFF
  // para no saturar Supabase con millones de rows)
  if (process.env.METRICS_PERSIST === 'true') {
    supabaseAdmin.from('metrics').insert({
      tenant_id: m.tenantId || null,
      name: m.name,
      value: m.value,
      unit: m.unit || 'count',
      tags: m.tags || {},
      created_at: entry.ts,
    }).then(() => {}, (err) => {
      console.warn('[metrics] persist failed:', err instanceof Error ? err.message : err);
    });
  }
}

/** Timing helper: mide y emite en ms. */
export function timed<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { tenantId?: string; tags?: Record<string, string | number> } = {},
): Promise<T> {
  const start = Date.now();
  return fn().then(
    (result) => {
      emit({ name, value: Date.now() - start, unit: 'ms', ...opts });
      return result;
    },
    (err) => {
      emit({
        name: `${name}.error`,
        value: Date.now() - start,
        unit: 'ms',
        ...opts,
        tags: { ...opts.tags, error: err instanceof Error ? err.name : 'unknown' },
      });
      throw err;
    },
  );
}

/** Incrementa un contador (shortcut común). */
export function count(name: string, tenantId?: string, tags?: Record<string, string | number>): void {
  emit({ name, value: 1, unit: 'count', tenantId, tags });
}

/** Registra costo LLM en USD (para dashboard de gross margin). */
export function cost(amountUsd: number, tenantId: string, model: string): void {
  emit({
    name: 'llm.cost',
    value: amountUsd,
    unit: 'usd',
    tenantId,
    tags: { model },
  });
  // Fire-and-forget — no bloqueamos el hot path del webhook.
  void trackTenantCost(tenantId, amountUsd).catch((err) => {
    console.warn('[metrics] trackTenantCost failed:', err instanceof Error ? err.message : err);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PER-TENANT COST ALERTING
// Acumula costo LLM diario por tenant en Redis. Cuando un tenant cruza umbrales
// (soft/hard), emite un log ALERT. El dashboard y el cron diario pueden leer
// la key para enforcement/visualización.
//
// Thresholds conservadores — cubren el 99% de SMEs; los premium con más tráfico
// pueden override via env. Un bug de bucle infinito puede costar $100+/día
// sin alertas — éste es el último eslabón de defense-in-depth después de rate
// limiting y circuit breaker.
// ═════════════════════════════════════════════════════════════════════════════

const DAILY_SOFT_USD = Number(process.env.TENANT_DAILY_COST_SOFT_USD || '5');
const DAILY_HARD_USD = Number(process.env.TENANT_DAILY_COST_HARD_USD || '20');
const COST_KEY_TTL_SECONDS = 2 * 24 * 3600; // 48h — margen para el cron.

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function dayKey(tenantId: string, date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `cost:tenant:${tenantId}:${y}${m}${d}`;
}

async function trackTenantCost(tenantId: string, amountUsd: number): Promise<void> {
  if (!tenantId || amountUsd <= 0) return;
  const redis = getRedis();
  if (!redis) return;

  const key = dayKey(tenantId);
  // INCRBYFLOAT es atómico en Redis; el SET EXPIRE lo hacemos en el primer
  // write del día vía Lua para evitar keys inmortales.
  const total = (await redis.eval(
    "local v = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]); if tonumber(redis.call('TTL', KEYS[1])) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end; return v",
    [key],
    [String(amountUsd), String(COST_KEY_TTL_SECONDS)],
  )) as string | number;

  const totalNum = typeof total === 'string' ? parseFloat(total) : total;
  if (!isFinite(totalNum)) return;

  // Alert soft: primera vez en el día que cruza soft. Track en Redis con una
  // flag para no spammear logs cada request.
  const alertKey = `${key}:alert`;
  if (totalNum >= DAILY_HARD_USD) {
    const already = await redis.get<string>(alertKey);
    if (already !== 'hard') {
      console.error(
        `[cost-alert] HARD tenant=${tenantId} daily=${totalNum.toFixed(4)} USD (threshold ${DAILY_HARD_USD})`,
      );
      await redis.set(alertKey, 'hard', { ex: COST_KEY_TTL_SECONDS });
    }
  } else if (totalNum >= DAILY_SOFT_USD) {
    const already = await redis.get<string>(alertKey);
    if (!already) {
      console.warn(
        `[cost-alert] SOFT tenant=${tenantId} daily=${totalNum.toFixed(4)} USD (threshold ${DAILY_SOFT_USD})`,
      );
      await redis.set(alertKey, 'soft', { ex: COST_KEY_TTL_SECONDS });
    }
  }
}

/** Lee el costo del día actual para un tenant. Útil para dashboard y crons. */
export async function getTenantDailyCost(tenantId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const v = await redis.get<string | number>(dayKey(tenantId));
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Umbrales en USD (exportados para dashboard y tests). */
export const TENANT_COST_THRESHOLDS = {
  softUsd: DAILY_SOFT_USD,
  hardUsd: DAILY_HARD_USD,
};

/**
 * Error lanzado cuando un tenant excedió su cap de costo diario hard.
 * El orchestrator lo captura y muestra al usuario un mensaje calmo
 * ("estamos al límite del día, intenta mañana") y al owner del tenant
 * se le notifica para upgrade o investigar el bug que causó el spike.
 */
export class TenantCostCapExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly dailyUsd: number,
    public readonly hardLimit: number,
  ) {
    super(
      `Tenant ${tenantId} exceeded hard daily cost limit: ${dailyUsd.toFixed(4)} >= ${hardLimit} USD`,
    );
    this.name = 'TenantCostCapExceededError';
  }
}

/**
 * Hard-block: lanza `TenantCostCapExceededError` si el tenant ya gastó
 * `>= DAILY_HARD_USD` hoy. Llamar ANTES de cada LLM call costosa
 * (orchestrator entry point, response-builder).
 *
 * Diferencia con `trackTenantCost`: éste solo loguea ALERTAS post-facto.
 * `enforceTenantCostCap` previene el siguiente gasto.
 *
 * Defense-in-depth: si un bug del LLM mete loop costoso, el cap detiene
 * sangría. Sin esto, un tenant puede gastar miles de USD en horas antes
 * de que alguien lea los logs `[cost-alert] HARD`.
 */
export async function enforceTenantCostCap(tenantId: string): Promise<void> {
  if (!tenantId) return;
  const dailyUsd = await getTenantDailyCost(tenantId);
  if (dailyUsd >= DAILY_HARD_USD) {
    throw new TenantCostCapExceededError(tenantId, dailyUsd, DAILY_HARD_USD);
  }
}
