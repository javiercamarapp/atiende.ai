// ═════════════════════════════════════════════════════════════════════════════
// AGENT_REGISTRY — fuente única de verdad de qué agentes existen, qué modelo
// usan y qué tools tienen.
//
// Phase 2: orchestrator + agenda + no-show + faq (active)
// Phase 3.B.1: post-consulta + encuesta + medicamento + intake (active)
// Phase 3.B.2 (pending): retencion + agenda-gap + reputacion + cobranza
// Phase 3 placeholders restantes: triaje
// ═════════════════════════════════════════════════════════════════════════════

import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig, AgentName } from './types';
import { triajeConfig } from './placeholders/triaje';
import { retencionConfig } from './placeholders/retencion';
import { cobranzaConfig } from './placeholders/cobranza';
import { reputacionConfig } from './placeholders/reputacion';

export const AGENT_REGISTRY: Record<AgentName, AgentConfig> = {
  orchestrator: {
    name: 'orchestrator',
    model: MODELS.ORCHESTRATOR,
    description: 'Rutea mensajes al sub-agente correcto',
    tools: ['escalate_to_human_orchestrator'],
    systemPromptKey: 'orchestrator',
  },
  agenda: {
    name: 'agenda',
    model: MODELS.ORCHESTRATOR,
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
    model: MODELS.ORCHESTRATOR_FALLBACK,
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
    model: 'none',
    description: 'Responde preguntas frecuentes vía pattern matching',
    tools: [],
    systemPromptKey: 'faq',
  },

  // ── Phase 3.B.1 — agentes activos ────────────────────────────────────────
  'post-consulta': {
    name: 'post-consulta',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Envía instrucciones post-visita y dispara seguimiento + cobranza',
    tools: [
      'get_appointment_details',
      'send_post_visit_instructions',
      'schedule_next_appointment_reminder',
      'request_payment_if_pending',
    ],
    systemPromptKey: 'post-consulta',
  },
  encuesta: {
    name: 'encuesta',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Encuesta de satisfacción 2h post-cita',
    tools: ['send_satisfaction_survey', 'save_survey_response', 'analyze_survey_sentiment'],
    systemPromptKey: 'encuesta',
  },
  medicamento: {
    name: 'medicamento',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Parsea prescripciones y agenda recordatorios de medicamentos',
    tools: [
      'parse_prescription_from_notes',
      'schedule_medication_reminders',
      'send_medication_reminder',
      'mark_reminder_completed',
    ],
    systemPromptKey: 'medicamento',
  },
  intake: {
    name: 'intake',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Recopila historia médica básica del paciente nuevo',
    tools: ['send_intake_form', 'save_intake_data', 'mark_intake_completed'],
    systemPromptKey: 'intake',
  },

  // ── Phase 3.B.2 — pendientes (placeholders del registry de Phase 1) ──────
  retencion: retencionConfig,
  'agenda-gap': {
    name: 'agenda-gap',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Llena huecos de agenda contactando a pacientes elegibles [3.B.2]',
    tools: [],
    systemPromptKey: 'agenda-gap',
  },
  triaje: triajeConfig,
  cobranza: cobranzaConfig,
  reputacion: reputacionConfig,
};
