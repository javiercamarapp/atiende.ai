# Internal Agents — Phase 3.C

Estos agentes corren en la operación interna de atiende.ai (Javier-only).
NO se exponen a tenants y no consumen tools del registry global del orquestador
de WhatsApp.

Cada archivo exporta funciones puras llamables por crons internos o por el
dashboard de admin. NO usan `registerTool()` — son utilities, no tools del LLM.

| Archivo | Propósito | Modelo | Frecuencia |
|---------|-----------|--------|------------|
| `agent-performance.ts` | Métricas por agente y tenant | deepseek-v3-2 | tiempo real + nocturno |
| `intent-quality.ts` | Detecta clasificaciones erróneas | gpt-4.1-mini | nocturno |
| `faq-gap-detector.ts` | Encuentra preguntas sin respuesta + clusterea | embeddings + gpt-4.1-mini | semanal |
| `onboarding-prompt-generator.ts` | Genera prompts personalizados al onboardear tenant | qwen3.6-plus | on-demand |
| `prompt-fine-tuning.ts` | Mejora prompts basado en fallos | gpt-4.1-mini | semanal |
| `fraud-detector.ts` | Detecta anomalías de volumen + injection attempts | SQL + gpt-4.1-mini | nocturno |

Implementación Phase 3.C: scaffolding con tipos + signatures completas.
Implementaciones LLM concretas vendrán en Phase 3.E (post-MVP) — por ahora
la infraestructura de tipos + queries SQL está lista para que los crons
puedan llamarlas y generar reportes.
