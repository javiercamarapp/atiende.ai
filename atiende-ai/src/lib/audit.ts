import { supabaseAdmin } from '@/lib/supabase/admin';

export async function logAudit(params: {
  tenantId: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  await supabaseAdmin.from('audit_log').insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId,
    details: params.details,
    ip_address: params.ipAddress,
  });
}
