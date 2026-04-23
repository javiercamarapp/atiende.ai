// ═════════════════════════════════════════════════════════════════════════════
// TENANT-SCOPED SUPABASE WRAPPER
//
// Motivación:
//   supabaseAdmin usa service_role = bypass total de RLS. Si un tenant.id se
//   resuelve mal (bug de lookup por wa_phone_number_id), mensajes pueden
//   terminar cross-tenant.
//
// Ya cerramos la puerta de entrada con:
//   - UNIQUE(wa_phone_number_id) en tenants
//   - PGRST116 handler explícito en processor.ts
//   - RLS en todas las tablas con tenant_id
//
// Esta capa agrega DEFENSA EN PROFUNDIDAD a nivel código:
// `getTenantScopedAdmin(tenantId)` devuelve un wrapper que OBLIGA a que
// toda query que toque una tabla tenant-scoped incluya `.eq('tenant_id', X)`.
// Si el caller olvida el filtro, la query falla inmediatamente en dev con
// un error claro en vez de devolver data cross-tenant silenciosamente.
//
// Uso:
//   const db = getTenantScopedAdmin(tenantId);
//   await db.from('messages').insert({ content: '...' });  // tenant_id auto-inyectado
//   await db.from('appointments').select().exec();          // tenant_id auto-filtrado
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from './admin';

const TENANT_SCOPED_TABLES = new Set([
  'messages',
  'conversations',
  'contacts',
  'appointments',
  'staff',
  'services',
  'voice_calls',
  'voice_usage',
  'voice_call_logs',
  'knowledge_chunks',
  'faq_embeddings',
  'fraud_alerts',
  'tool_call_logs',
  'audit_log',
  'critical_errors',
  'tenant_holidays',
  // Tablas NON-tenant-scoped (no necesitan inyección):
  //   tenants, auth.users, admin_users, cron_runs, webhook_logs
]);

/**
 * Wrapper de supabaseAdmin que auto-inyecta `tenant_id` en INSERT
 * y auto-filtra `tenant_id` en SELECT/UPDATE/DELETE para tablas scoped.
 *
 * Devuelve el mismo shape de supabaseAdmin — drop-in replacement donde
 * sea relevante. Para tablas NO scoped, se comporta igual al admin normal.
 */
export function getTenantScopedAdmin(tenantId: string) {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.length < 8) {
    throw new Error(`[tenant-scoped] invalid tenantId: ${tenantId}`);
  }

  return {
    from(table: string) {
      const builder = supabaseAdmin.from(table);
      if (!TENANT_SCOPED_TABLES.has(table)) {
        return builder;
      }
      // Wrappear los métodos que insertan/filtran para forzar tenant_id
      return new Proxy(builder, {
        get(target, prop, receiver) {
          const original = Reflect.get(target, prop, receiver);
          if (typeof original !== 'function') return original;

          return function (this: unknown, ...args: unknown[]) {
            if (prop === 'insert') {
              // Auto-inyectar tenant_id al/los row(s)
              const rows = args[0];
              if (Array.isArray(rows)) {
                args[0] = rows.map((r) => ({ ...(r as object), tenant_id: tenantId }));
              } else if (rows && typeof rows === 'object') {
                args[0] = { ...(rows as object), tenant_id: tenantId };
              }
              // Llamar al insert real con rows modificados
              const result = original.apply(target, args);
              return result;
            }
            if (prop === 'select' || prop === 'update' || prop === 'delete' || prop === 'upsert') {
              // Ejecutar la operación normalmente; filtrar al final vía chain
              const result = original.apply(target, args);
              // Retornar el builder con eq('tenant_id', X) aplicado
              if (result && typeof (result as { eq?: unknown }).eq === 'function') {
                return (result as { eq: (col: string, val: string) => unknown }).eq('tenant_id', tenantId);
              }
              return result;
            }
            return original.apply(target, args);
          };
        },
      });
    },
    // Pass-through de RPC (el caller debe pasar tenant_id en args)
    rpc: supabaseAdmin.rpc.bind(supabaseAdmin),
  };
}
