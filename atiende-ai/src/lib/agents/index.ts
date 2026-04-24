// ═════════════════════════════════════════════════════════════════════════════
// AGENTS BARREL — entry point del sistema multi-agente
//
// Importar este archivo:
//   1. Carga los registros de tools de AGENDA y NO-SHOW (side effect).
//   2. Expone helpers: buildTenantContext, getSystemPrompt, getAgentTools,
//      routeToAgent.
//
// El processor.ts importa de aquí cuando termine la fase de wiring.
// ═════════════════════════════════════════════════════════════════════════════

// Side effects: registran tools en el toolRegistry global.
import './shared';  // tools compartidos: update_patient_profile, save_patient_document, etc.
import './agenda';
import './no-show';
import './post-consulta';
import './encuesta';
import './medicamento';
import './intake';
import './retencion';
import './agenda-gap';
import './reputacion';
import './cobranza';

import type { AgentName, TenantContext, FastRoute } from './types';
import { AGENT_REGISTRY } from './registry';
import { getOrchestratorPrompt } from './orchestrator-prompt';
import { getAgendaPrompt } from './agenda/prompt';
import { getNoShowPrompt } from './no-show/prompt';
import { getPostConsultaPrompt } from './post-consulta/prompt';
import { getEncuestaPrompt } from './encuesta/prompt';
import { getMedicamentoPrompt } from './medicamento/prompt';
import { getIntakePrompt } from './intake/prompt';
import { getRetencionPrompt } from './retencion/prompt';
import { getAgendaGapPrompt } from './agenda-gap/prompt';
import { getReputacionPrompt } from './reputacion/prompt';
import { getCobranzaPrompt } from './cobranza/prompt';

export type { AgentName, TenantContext, FastRoute, AgentConfig } from './types';
export { AGENT_REGISTRY } from './registry';

// ─────────────────────────────────────────────────────────────────────────────
// buildTenantContext — construye el TenantContext desde el row del tenant
// ─────────────────────────────────────────────────────────────────────────────

import { resolveTenantTimezone } from '@/lib/config';

function getDateInTz(timezone: string, offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // → "YYYY-MM-DD"
}

function nextMondayInTz(timezone: string): string {
  const todayInTz = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
    }).format(new Date()),
  );
  const dow = todayInTz.getDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = (8 - dow) % 7 || 7;
  return getDateInTz(timezone, daysUntilMonday);
}

function parseHoursWindow(s: string | undefined): { open: string; close: string } | null {
  if (!s || s === 'cerrado' || !s.includes('-')) return null;
  const [open, close] = s.split('-');
  return open && close ? { open, close } : null;
}

export function buildTenantContext(
  tenant: Record<string, unknown>,
  opts?: { customerName?: string | null; customerPhone?: string | null },
): TenantContext {
  const timezone = resolveTenantTimezone(tenant);
  const rawHours = (tenant.business_hours as Record<string, string>) || {};
  const businessHours: Record<string, { open: string; close: string }> = {};
  for (const [day, str] of Object.entries(rawHours)) {
    const w = parseHoursWindow(str);
    if (w) businessHours[day] = w;
  }

  const services = ((tenant.services as Array<Record<string, unknown>>) || []).map((s) => ({
    name: (s.name as string) || '',
    price: Number(s.price ?? 0),
    duration: Number(s.duration_minutes ?? s.duration ?? 30),
  }));

  const currentDatetime = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');

  return {
    tenantId: (tenant.id as string) || '',
    businessName: (tenant.name as string) || 'el negocio',
    businessType: (tenant.business_type as string) || 'other',
    businessCity: (tenant.city as string) || '',
    businessHours,
    timezone,
    services,
    doctorName: (tenant.doctor_name as string) || undefined,
    emergencyPhone: (tenant.emergency_phone as string) || (tenant.phone as string) || undefined,
    currentDatetime,
    tomorrowDate: getDateInTz(timezone, 1),
    dayAfterTomorrow: getDateInTz(timezone, 2),
    nextWeekStart: nextMondayInTz(timezone),
    customerName: opts?.customerName?.trim() || undefined,
    customerPhone: opts?.customerPhone?.trim() || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getSystemPrompt — switch sobre agentName → prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function getSystemPrompt(agentName: AgentName, ctx: TenantContext): string {
  switch (agentName) {
    case 'orchestrator': return getOrchestratorPrompt(ctx);
    case 'agenda':       return getAgendaPrompt(ctx);
    case 'no-show':      return getNoShowPrompt(ctx);
    case 'post-consulta': return getPostConsultaPrompt(ctx);
    case 'encuesta':     return getEncuestaPrompt(ctx);
    case 'medicamento':  return getMedicamentoPrompt(ctx);
    case 'intake':       return getIntakePrompt(ctx);
    case 'retencion':    return getRetencionPrompt(ctx);
    case 'agenda-gap':   return getAgendaGapPrompt(ctx);
    case 'reputacion':   return getReputacionPrompt(ctx);
    case 'cobranza':     return getCobranzaPrompt(ctx);
    case 'faq':
      return '(FAQ no usa LLM — los handlers son funciones directas en src/lib/agents/faq/tools.ts)';
    case 'triaje':
      return `[Placeholder Phase 3.C] Agente triaje aún no implementado.`;
    default: {
      const _exhaustive: never = agentName;
      return _exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getAgentTools — lista de tool names del agente según AGENT_REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export function getAgentTools(agentName: AgentName): string[] {
  return AGENT_REGISTRY[agentName].tools;
}

// ─────────────────────────────────────────────────────────────────────────────
// routeToAgent — fast path antes de tocar el LLM
// ─────────────────────────────────────────────────────────────────────────────

const URGENCY_KEYWORDS = [
  'dolor severo', 'no puedo respirar', 'emergencia', 'accidente',
  'sangrado', 'auxilio', 'urgente', 'muy mal', 'desmayo',
  'inconsciente', 'crisis', 'me muero',
];

const FAQ_KEYWORDS = [
  'horario', 'hora', 'atienden', 'abierto', 'que dias', 'que días',
  'direccion', 'dirección', 'donde estan', 'donde están', 'ubicacion', 'ubicación',
  'precio', 'precios', 'costo', 'cuanto cuesta', 'cuánto cuesta', 'cobran', 'tarifa',
  'seguro', 'aseguradora', 'insurance', 'issste', 'imss',
  'estacionamiento', 'parking', 'maps',
];

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Fast path: revisa el mensaje contra patterns de urgencia y FAQ ANTES de
 * llamar al LLM. Retorna 'urgent' o 'faq' si hay match, null si el LLM debe
 * decidir.
 */
export function routeToAgent(message: string, _ctx: TenantContext): FastRoute {
  const norm = normalizeForMatch(message);

  if (URGENCY_KEYWORDS.some((kw) => norm.includes(normalizeForMatch(kw)))) {
    return 'urgent';
  }

  if (FAQ_KEYWORDS.some((kw) => norm.includes(normalizeForMatch(kw)))) {
    return 'faq';
  }

  return null;
}

// Re-export del FAQ handler para que processor lo importe del barrel.
export { handleFAQ } from './faq';

// ─────────────────────────────────────────────────────────────────────────────
// initializeAllAgents — verifica que todos los side-effect imports realmente
// hayan registrado sus tools. Llamar al boot del proceso (top-level del
// processor.ts) garantiza que cualquier error de carga de módulo crashea
// fail-fast en lugar de manifestarse como tool 'not registered' al primer
// mensaje real.
// ─────────────────────────────────────────────────────────────────────────────
import { listRegisteredTools } from '@/lib/llm/tool-executor';

export function initializeAllAgents(): { ok: boolean; tools: string[]; missing: string[] } {
  const registered = listRegisteredTools();
  // Tools mínimas que DEBEN existir si los side-effect imports cargaron OK.
  const required = [
    'check_availability',
    'book_appointment',
    'get_my_appointments',
    'modify_appointment',
    'cancel_appointment',
    // no-show worker tools (cron deberá llamarlas)
    'get_appointments_tomorrow',
    'send_confirmation_request',
    'mark_confirmed',
    'mark_no_show',
    'notify_risk',
    // shared profile enrichment tools (usados por agenda + intake)
    'update_patient_profile',
    'save_patient_document',
    'escalate_urgency',
    'create_referred_contact',
    'save_patient_preferences',
    // shared conversion + compliance tools (Phase 1)
    'get_service_quote',
    'save_patient_guardian',
    'validate_minor_permission',
    'retrieve_doctor_expertise',
    'capture_marketing_source',
  ];
  const missing = required.filter((n) => !registered.includes(n));
  if (missing.length > 0) {
    console.error('[agents] CRITICAL: missing required tools after init:', missing);
  }
  return { ok: missing.length === 0, tools: registered, missing };
}

/**
 * ensureToolsRegistered — alias explícito de
 * `initializeAllAgents()` que además LANZA si faltan tools mínimas. Usado
 * al boot de processor.ts para fail-fast si el code-split de Vercel dejó
 * algún módulo de agente sin cargar.
 *
 * Este archivo ya importa `./agenda` y `./no-show` al inicio (side effects),
 * así que llamar aquí garantiza que esos módulos fueron evaluados.
 */
export function ensureToolsRegistered(): void {
  const r = initializeAllAgents();
  if (!r.ok) {
    throw new Error(
      `[agents] Tool registry incomplete at boot — missing: ${r.missing.join(', ')}. ` +
      `Este proceso no puede atender mensajes con seguridad.`,
    );
  }
}
