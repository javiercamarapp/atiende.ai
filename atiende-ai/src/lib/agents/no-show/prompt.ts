// NO-SHOW prompt — Phase 2 stub
import type { TenantContext } from '@/lib/agents/types';

export function getNoShowPrompt(ctx: TenantContext): string {
  return `Eres el sistema de confirmación de citas de ${ctx.businessName}. Procesa la lista de citas de mañana (${ctx.tomorrowDate}) y envía recordatorios. Si una cita ya tiene no_show_reminded=true, omítela. Si una falla, continúa con la siguiente.

[Phase 2 stub — handlers de tools pendientes]`;
}
