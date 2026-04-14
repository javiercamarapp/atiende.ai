// ═════════════════════════════════════════════════════════════════════════════
// AGENT_REGISTRY — fuente única de verdad de qué agentes existen, qué modelo
// usan y qué tools tienen. Activos: orchestrator, agenda, no-show, faq.
// Placeholders (Phase 3): post-consulta, retencion, triaje, cobranza, reputacion.
// ═════════════════════════════════════════════════════════════════════════════

import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig, AgentName } from './types';
import { postConsultaConfig } from './placeholders/post-consulta';
import { retencionConfig } from './placeholders/retencion';
import { triajeConfig } from './placeholders/triaje';
import { cobranzaConfig } from './placeholders/cobranza';
import { reputacionConfig } from './placeholders/reputacion';

export const AGENT_REGISTRY: Record<AgentName, AgentConfig> = {
  orchestrator: {
    name: 'orchestrator',
    model: MODELS.ORCHESTRATOR, // x-ai/grok-4.1-fast
    description: 'Rutea mensajes al sub-agente correcto y maneja casos triviales',
    // El orquestador SOLO necesita tool de escalación; el resto delega.
    tools: ['escalate_to_human_orchestrator'],
    systemPromptKey: 'orchestrator',
  },
  agenda: {
    name: 'agenda',
    model: MODELS.ORCHESTRATOR, // x-ai/grok-4.1-fast
    description: 'Agenda, modifica, cancela y consulta citas',
    tools: [
      'check_availability',
      'book_appointment',
      'get_my_appointments',
      'modify_appointment',
      'cancel_appointment',
    ],
    systemPromptKey: 'agenda',
  },
  'no-show': {
    name: 'no-show',
    model: MODELS.ORCHESTRATOR_FALLBACK, // openai/gpt-4.1-mini (worker)
    description: 'Worker autónomo: envía recordatorios de confirmación 24h antes',
    tools: [
      'get_appointments_tomorrow',
      'send_confirmation_request',
      'mark_confirmed',
      'mark_no_show',
      'notify_risk',
    ],
    systemPromptKey: 'no-show',
  },
  faq: {
    name: 'faq',
    model: 'none', // sin LLM — fast path con regex
    description: 'Responde preguntas frecuentes vía pattern matching (no LLM)',
    tools: [],
    systemPromptKey: 'faq',
  },

  // ── Placeholders (Phase 3) — registry completo desde Phase 2 ──────────────
  'post-consulta': postConsultaConfig,
  retencion: retencionConfig,
  triaje: triajeConfig,
  cobranza: cobranzaConfig,
  reputacion: reputacionConfig,
};
