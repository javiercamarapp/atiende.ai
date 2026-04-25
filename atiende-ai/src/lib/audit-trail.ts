// ═════════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL — registro estructurado de mutaciones admin/cron
//
// Antes: los crons admin (backfill-knowledge-metadata, refresh-mat-views,
// etc.) modificaban filas de tenants vía `supabaseAdmin` sin dejar rastro
// de "qué tenant fue tocado por qué proceso, cuándo y con qué cambios".
// Si un cron rompe datos, el debugging exige reconstruir lo ocurrido a
// partir de logs de Vercel — frágil y caro.
//
// Este wrapper registra cada mutación admin/cron en `audit_log` con:
//   - actor (cron-name o admin user_id)
//   - tenant_id afectado
//   - acción + entidad
//   - detalles (campos modificados, payload reducido)
//
// Diseño: best-effort. Si la inserción falla, NO interrumpimos la operación
// principal — solo logueamos un warning. La auditoría no debe romper crons
// críticos. Si necesitas garantía hard, hazlo desde una migration con
// triggers PostgreSQL (más caro, más confiable).
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export interface AuditEntry {
  /** Quién realizó la acción. Para crons: 'cron:nombre-del-job'. Para admin: user_id UUID. */
  actor: string;
  /** Tenant impactado. Null si la acción es global. */
  tenantId: string | null;
  /** Acción canónica (verbo). Ej: 'tenant_update', 'admin_backfill', 'plan_change'. */
  action: string;
  /** Tipo de entidad mutada. Ej: 'tenant', 'staff', 'appointment'. */
  entityType?: string;
  /** ID UUID de la entidad mutada (si aplica). */
  entityId?: string;
  /** Payload arbitrario: campos cambiados, valores antes/después, contadores. */
  details?: Record<string, unknown>;
  /** IP del request (si aplica). Crons no tienen IP. */
  ipAddress?: string | null;
}

/**
 * Inserta un registro en `audit_log`. Best-effort.
 *
 * Uso típico (cron):
 *
 *   await audit({
 *     actor: 'cron:backfill-knowledge-metadata',
 *     tenantId: t.id,
 *     action: 'admin_backfill',
 *     entityType: 'knowledge_chunks',
 *     details: { rows_updated: n, fields: ['embedding_version'] },
 *   });
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      tenant_id: entry.tenantId,
      user_id: looksLikeUuid(entry.actor) ? entry.actor : null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      details: {
        ...(entry.details ?? {}),
        actor_label: entry.actor,
      },
      ip_address: entry.ipAddress ?? null,
    });
    if (error) {
      logger.warn('[audit] insert failed (non-fatal)', {
        action: entry.action,
        tenant_id: entry.tenantId,
        err: error.message,
      });
    }
  } catch (err) {
    logger.warn('[audit] unexpected error (non-fatal)', {
      action: entry.action,
      tenant_id: entry.tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wrapper para mutaciones admin que registra automáticamente al éxito.
 * Si la mutación lanza, NO se inserta el audit (mantiene la semántica
 * "audit registra lo que efectivamente ocurrió"). El error se re-lanza.
 *
 * Uso:
 *   const result = await auditedAdminMutation(
 *     { actor: 'cron:plan-overage', tenantId, action: 'plan_overage_charge', entityType: 'tenants', entityId: tenantId, details: { mxn: 199 } },
 *     async () => supabaseAdmin.from('tenants').update({ plan_overage_charged: true }).eq('id', tenantId),
 *   );
 */
export async function auditedAdminMutation<T>(
  entry: AuditEntry,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();
  // Insertamos el audit FUERA del try del caller (después del éxito).
  void audit(entry);
  return result;
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
