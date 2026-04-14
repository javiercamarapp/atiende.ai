// PLACEHOLDER — agente COBRANZA (Phase 3)
import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig } from '@/lib/agents/types';

export const cobranzaConfig: AgentConfig = {
  name: 'cobranza',
  model: MODELS.ORCHESTRATOR_FALLBACK,
  description: 'Recordatorios de pago y seguimiento de adeudos [Fase 3 — pendiente]',
  tools: [],
  systemPromptKey: 'cobranza',
};
