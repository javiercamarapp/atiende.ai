// ═════════════════════════════════════════════════════════════════════════════
// AGENT REGISTRY (Phase 2)
//
// Exporta `selectAgentForTenant()` que decide qué sub-agente usar para un
// tenant dado. En Phase 2.1 retorna SIEMPRE `appointmentsAgent` — todos los
// tenants con tool_calling activo usan el mismo agente. Phase 3 ramificará
// por business_type / vertical (gastronomic_agent, retail_agent, etc.).
//
// IMPORTANTE: el side effect de importar este barrel REGISTRA todos los tools
// (vía `import './tools'`) — el processor solo necesita importar este file.
// ═════════════════════════════════════════════════════════════════════════════

// Side effect: registra todas las tools en el registry global
import '@/lib/llm/tools';

import { appointmentsAgent, type AgentDefinition } from './appointments-agent';

export type { AgentDefinition, AgentTenantContext } from './appointments-agent';
export { appointmentsAgent };

/**
 * Decide qué sub-agente atiende a este tenant. Phase 2.1: hardcoded a
 * appointmentsAgent para todos. Phase 3: ramifica por business_type.
 */
export function selectAgentForTenant(_tenant: Record<string, unknown>): AgentDefinition {
  // Phase 2.1: un solo agente para todos los tenants con tool_calling=true.
  // El feature flag por-tenant ya garantiza que solo activamos esto en
  // Salud / Estética (los verticales activos del MVP).
  return appointmentsAgent;
}
