// PLACEHOLDER — agente TRIAJE (Phase 3)
import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig } from '@/lib/agents/types';

export const triajeConfig: AgentConfig = {
  name: 'triaje',
  model: MODELS.ORCHESTRATOR, // Grok 4.1 Fast — necesita razonamiento clínico básico
  description: 'Detección de urgencias clínicas [Fase 3 — pendiente]',
  tools: [],
  systemPromptKey: 'triaje',
};
