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
      // Shared profile tools — el agente agenda ve mensajes libres del
      // paciente y debe poder guardar cualquier dato nuevo que aparezca
      // en medio del flujo (alergia reciente, cambio de dirección,
      // urgencia, referido, preferencias).
      'update_patient_profile',
      'save_patient_document',
      'escalate_urgency',
      'create_referred_contact',
      'save_patient_preferences',
      // Conversion + compliance tools (Phase 1): cotizar, validar menor,
      // bio del doctor, source de marketing.
      'get_service_quote',
      'save_patient_guardian',
      'validate_minor_permission',
      'retrieve_doctor_expertise',
      'capture_marketing_source',
      // Patient Payment Portal (Phase 1)
      'send_payment_link',
    ],
    systemPromptKey: 'agenda',
  },
  'no-show': {
    name: 'no-show',
    // Worker batch — usa gpt-4.1-mini como primary (no fallback) por costo.
    // No conversacional, no requiere Grok por latencia baja.
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
    tools: [
      'send_intake_form',
      'save_intake_data',
      'mark_intake_completed',
      // Durante el intake el paciente puede mencionar urgencia,
      // preferencia o mandar una foto de INE. Los tools compartidos
      // cubren esos casos sin romper el flow.
      'escalate_urgency',
      'save_patient_document',
      'save_patient_preferences',
      // Phase 1: capturar source de marketing apenas arranca la
      // conversación + registrar tutor si el paciente es menor.
      'capture_marketing_source',
      'save_patient_guardian',
      'validate_minor_permission',
    ],
    systemPromptKey: 'intake',
  },

  // ── Phase 3.B.2 — agentes activos ────────────────────────────────────────
  retencion: {
    name: 'retencion',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Reactiva pacientes con churn alto vía mensajes personalizados',
    tools: [
      'get_patients_at_risk',
      'generate_retention_message',
      'send_retention_message',
      'mark_patient_reactivated',
    ],
    systemPromptKey: 'retencion',
  },
  'agenda-gap': {
    name: 'agenda-gap',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Detecta huecos de agenda y propone slots a pacientes elegibles',
    tools: ['detect_schedule_gaps', 'get_candidates_for_gaps', 'send_gap_fill_message'],
    systemPromptKey: 'agenda-gap',
  },
  reputacion: {
    name: 'reputacion',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: '24h post-encuesta excelente, solicita reseña Google',
    tools: ['send_review_request', 'track_review_sent'],
    systemPromptKey: 'reputacion',
  },
  cobranza: {
    name: 'cobranza',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Recordatorios de pago escalados por vencimiento',
    tools: ['get_pending_payments', 'send_payment_reminder', 'mark_payment_received'],
    systemPromptKey: 'cobranza',
  },

  // ── Phase 1 — 5 subagentes del audit ─────────────────────────────────────
  quoting: {
    name: 'quoting',
    model: MODELS.ORCHESTRATOR,
    description: 'Cotizaciones de servicios y paquetes + follow-up si no agenda',
    tools: [
      'get_service_quote',           // shared — read-only
      'save_quote_interest',
      'schedule_quote_followup',
      // Fallback a agenda si el paciente decide agendar en el mismo turno
      'check_availability',
      'book_appointment',
    ],
    systemPromptKey: 'quoting',
  },
  pharmacovigilance: {
    name: 'pharmacovigilance',
    model: MODELS.PREMIUM, // medical safety — usar el mejor modelo
    description: 'Reacciones adversas a medicamentos. Critical (COFEPRIS NOM-220)',
    tools: [
      'save_adverse_event',
      'get_doctor_guidance',
      'escalate_urgency', // shared — para severe/life_threatening
    ],
    systemPromptKey: 'pharmacovigilance',
  },
  administrative: {
    name: 'administrative',
    model: MODELS.ORCHESTRATOR_FALLBACK,
    description: 'Certificados médicos, expedientes, consentimientos no clínicos',
    tools: [
      'request_medical_certificate',
      'request_record_export',
      'request_parental_consent_form',
      'validate_minor_permission', // shared
      'escalate_urgency',          // shared — para casos urgentes
    ],
    systemPromptKey: 'administrative',
  },
  'doctor-profile': {
    name: 'doctor-profile',
    model: MODELS.ORCHESTRATOR,
    description: 'Bio/experticia del doctor + testimonials + CTA de booking',
    tools: [
      'list_staff',
      'get_doctor_testimonials',
      'retrieve_doctor_expertise',  // shared
      // Cierra con booking si el paciente convence
      'check_availability',
      'book_appointment',
    ],
    systemPromptKey: 'doctor-profile',
  },
  'payment-resolution': {
    name: 'payment-resolution',
    model: MODELS.ORCHESTRATOR,
    description: 'Disputas de cobro, historial de pagos, facturación CFDI',
    tools: [
      'get_payment_history',
      'request_invoice',
      'dispute_charge',
    ],
    systemPromptKey: 'payment-resolution',
  },

  // ── Phase 3 placeholders restantes ───────────────────────────────────────
  triaje: triajeConfig,
};
