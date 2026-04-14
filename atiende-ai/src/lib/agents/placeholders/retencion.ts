// PLACEHOLDER — agente RETENCION (Phase 3)
import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig } from '@/lib/agents/types';

export const retencionConfig: AgentConfig = {
  name: 'retencion',
  model: MODELS.ORCHESTRATOR_FALLBACK,
  description: 'Reactivación de pacientes inactivos [Fase 3 — pendiente]',
  tools: [],
  systemPromptKey: 'retencion',
};
