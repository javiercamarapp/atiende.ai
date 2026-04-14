// PLACEHOLDER — agente REPUTACION (Phase 3)
import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig } from '@/lib/agents/types';

export const reputacionConfig: AgentConfig = {
  name: 'reputacion',
  model: MODELS.ORCHESTRATOR_FALLBACK,
  description: 'Solicitar reseñas Google a pacientes satisfechos [Fase 3 — pendiente]',
  tools: [],
  systemPromptKey: 'reputacion',
};
