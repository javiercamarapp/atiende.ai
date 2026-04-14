// ═════════════════════════════════════════════════════════════════════════════
// Tipos compartidos del sistema multi-agente
// ═════════════════════════════════════════════════════════════════════════════

export type AgentName =
  | 'orchestrator'
  | 'agenda'
  | 'no-show'
  | 'faq'
  | 'post-consulta'
  | 'encuesta'
  | 'medicamento'
  | 'intake'
  | 'retencion'
  | 'agenda-gap'
  | 'triaje'
  | 'cobranza'
  | 'reputacion';

export type AgentConfig = {
  name: AgentName;
  /** Modelo OpenRouter — usar 'none' para agentes sin LLM (FAQ). */
  model: string;
  description: string;
  /** Nombres de tools registradas en `toolRegistry` (`src/lib/llm/tool-executor.ts`). */
  tools: string[];
  /** Key para selección del prompt en `getSystemPrompt(agentName, ctx)`. */
  systemPromptKey: string;
};

/**
 * Contexto del tenant inyectado en cada prompt y tool. Construido por
 * `buildTenantContext(tenant)` en `src/lib/agents/index.ts`.
 */
export type TenantContext = {
  tenantId: string;
  businessName: string;
  businessType: string;
  businessCity: string;
  /** Map día→ventana ej: { lun: { open:'09:00', close:'18:00' }, ... }. */
  businessHours: Record<string, { open: string; close: string }>;
  timezone: string;
  services: Array<{
    name: string;
    price: number;
    duration: number;
  }>;
  /** Nombre del doctor titular si aplica (consultorio individual). */
  doctorName?: string;
  /** Teléfono de emergencia que se le da al paciente en urgencias. */
  emergencyPhone?: string;
  /** "2026-04-15 14:30:00" en la zona horaria del tenant — para el LLM. */
  currentDatetime: string;
  /** "2026-04-16" — fecha de mañana en TZ del tenant. */
  tomorrowDate: string;
  /** "2026-04-17". */
  dayAfterTomorrow: string;
  /** "2026-04-20" — siguiente lunes. */
  nextWeekStart: string;
};

/**
 * Resultado del fast-path routing en `routeToAgent()`. Si retorna un valor
 * concreto, processor toma esa rama sin invocar al LLM; si retorna null,
 * se delega al orquestador LLM.
 */
export type FastRoute = 'urgent' | 'faq' | 'ambiguous' | null;
