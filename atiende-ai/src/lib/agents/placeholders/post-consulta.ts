// ═════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER — agente POST-CONSULTA (Phase 3)
// Solo expone el config para que el registry esté completo desde Phase 2.
// Los tools y el prompt se implementarán en Phase 3.
// ═════════════════════════════════════════════════════════════════════════════

import { MODELS } from '@/lib/llm/openrouter';
import type { AgentConfig } from '@/lib/agents/types';

export const postConsultaConfig: AgentConfig = {
  name: 'post-consulta',
  model: MODELS.ORCHESTRATOR_FALLBACK,
  description: 'Seguimiento post-consulta [Fase 3 — pendiente de implementar]',
  tools: [],
  systemPromptKey: 'post-consulta',
};
