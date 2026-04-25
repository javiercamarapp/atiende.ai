// ═════════════════════════════════════════════════════════════════════════════
// TENANT GUARDS — defensa cross-tenant compartida
//
// Antes cada agent tools.ts tenía su copia local de assertContact() (9 copias
// con minor diffs en el nombre del trackError event). Esto centralizado
// asegura mismo behavior + un solo punto a actualizar si la lógica cambia.
//
// Uso:
//   if (!(await assertContactInTenant(ctx.tenantId, ctx.contactId, 'agent_name'))) {
//     return { ok: false, error: 'contact does not belong to tenant' };
//   }
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { trackError } from '@/lib/monitoring';

/**
 * Verifica que un contact pertenece al tenant indicado. Defense in depth contra
 * prompt injection donde el LLM podría intentar referenciar un contact_id de
 * otro tenant.
 *
 * @param scopeName usado para el trackError event ej. 'agenda', 'triage'.
 *   Permite alertas/dashboards que distinguen qué agente intentó cross-tenant.
 */
export async function assertContactInTenant(
  tenantId: string | undefined | null,
  contactId: string | undefined | null,
  scopeName: string,
): Promise<boolean> {
  if (!tenantId || !contactId) return false;
  const { data } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!data) {
    trackError(`${scopeName}_tool_cross_tenant_blocked`);
    return false;
  }
  return true;
}
