// ═════════════════════════════════════════════════════════════════════════════
// METRICS — métricas estructuradas per-tenant (AUDIT R13 — rubro 5 → 10/10)
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
    }).then(() => {}, () => { /* best effort */ });
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
}
