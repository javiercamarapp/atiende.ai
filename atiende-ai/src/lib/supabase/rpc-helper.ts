// ═════════════════════════════════════════════════════════════════════════════
// RPC HELPER — wrapper para Supabase RPC calls con duration logging
//
// Antes: cada `.rpc(name, args)` se llamaba directo. Si tomaba 30s por un
// statement_timeout silencioso o un planner mal optimizado, no había forma
// de detectarlo en dashboards: solo "execution_failed" genérico.
//
// Ahora: callRpc() mide duración, loguea estructurado, y trackea métrica.
// El wrapper es type-safe y delega 100% del comportamiento al cliente
// Supabase original — solo agrega instrumentación.
//
// Uso:
//   const { data, error } = await callRpc(supabaseAdmin, 'upsert_inbound_message', {
//     p_tenant_id: tenantId,
//     p_wa_id: waId,
//   });
// ═════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { trackError } from '@/lib/monitoring';

const SLOW_RPC_MS = 1000;

export async function callRpc<TArgs extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(
  client: SupabaseClient,
  fn: string,
  args: TArgs,
  ctx?: { tenantId?: string; tag?: string },
): Promise<{ data: TResult | null; error: Error | null }> {
  const start = Date.now();
  // El cliente Supabase tipa rpc() de forma genérica que choca con TArgs
  // arbitrario; el cast es local y no escapa de esta función.
  const { data, error } = (await (client as unknown as {
    rpc: (n: string, a: TArgs) => Promise<{ data: TResult | null; error: { message: string; code?: string } | null }>;
  }).rpc(fn, args));
  const durationMs = Date.now() - start;

  if (error) {
    trackError(`rpc_failed:${fn}`);
    logger.warn('[rpc] failed', {
      fn,
      tenant_id: ctx?.tenantId,
      tag: ctx?.tag,
      duration_ms: durationMs,
      err: error.message,
      code: error.code,
    });
    return { data: null, error: new Error(error.message) };
  }

  if (durationMs >= SLOW_RPC_MS) {
    // Slow query log: dashboard p95 puede armarse contando estos.
    logger.warn('[rpc] slow_call', {
      fn,
      tenant_id: ctx?.tenantId,
      tag: ctx?.tag,
      duration_ms: durationMs,
    });
    trackError(`rpc_slow:${fn}`);
  } else {
    logger.debug('[rpc] ok', {
      fn,
      tenant_id: ctx?.tenantId,
      duration_ms: durationMs,
    });
  }

  return { data: data ?? null, error: null };
}
