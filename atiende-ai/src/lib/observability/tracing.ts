// ═════════════════════════════════════════════════════════════════════════════
// TRACING — request_id propagation via AsyncLocalStorage
//
// Problema sin tracing: cuando un mensaje rompe en producción, ops tiene
// que correlacionar manualmente logs de webhook → processor → orchestrator
// → tools sin un identificador común. Lleva horas.
//
// Solución: AsyncLocalStorage (Node.js nativo) propaga un context invisible
// a través del call stack. El webhook genera un request_id al inicio,
// runWithRequestContext() lo guarda, y cualquier código async puede leerlo
// con getRequestId() sin cambiar firmas de función.
//
// El logger automáticamente inyecta el request_id en cada log line. Las
// tablas messages/tool_call_logs/audit_log persisten el request_id para
// que ops pueda hacer una query SQL y traer toda la cadena.
// ═════════════════════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  requestId: string;
  tenantId?: string;
  conversationId?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Genera un request_id (UUID v4) y ejecuta `fn` dentro del contexto.
 * Cualquier código async dentro de fn puede leer el contexto con
 * `getRequestContext()` sin pasarlo como argumento.
 *
 * Uso típico — al inicio del webhook handler:
 *
 *   await runWithRequestContext({ requestId: crypto.randomUUID() }, async () => {
 *     await processMessage(...);
 *   });
 */
export async function runWithRequestContext<T>(
  ctx: Omit<RequestContext, 'startedAt'>,
  fn: () => Promise<T>,
): Promise<T> {
  const fullCtx: RequestContext = { ...ctx, startedAt: Date.now() };
  return storage.run(fullCtx, fn);
}

/**
 * Lee el contexto del request actual. Devuelve `null` si no hay
 * contexto (ej. cron job que no llamó runWithRequestContext).
 * El logger es defensivo: si no hay context, no agrega el campo.
 */
export function getRequestContext(): RequestContext | null {
  return storage.getStore() || null;
}

/** Atajo: solo el request_id, o null si no hay contexto. */
export function getRequestId(): string | null {
  return storage.getStore()?.requestId || null;
}

/**
 * Permite enriquecer el contexto a medida que el flow descubre datos
 * (ej. tenantId se sabe después del webhook lookup, conversationId
 * después del upsert). MUTA el store en sitio — todos los reads
 * subsecuentes ven el dato nuevo.
 */
export function enrichRequestContext(
  patch: Partial<Omit<RequestContext, 'requestId' | 'startedAt'>>,
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (patch.tenantId !== undefined) ctx.tenantId = patch.tenantId;
  if (patch.conversationId !== undefined) ctx.conversationId = patch.conversationId;
}

/** Tiempo transcurrido (ms) desde que arrancó el request. Útil para latency logs. */
export function getRequestElapsedMs(): number | null {
  const ctx = storage.getStore();
  if (!ctx) return null;
  return Date.now() - ctx.startedAt;
}
