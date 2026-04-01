# Auditoria Experta: atiende.ai

**Fecha:** 2026-04-01
**Calificacion Global:** 88/100 — MEJOR PROYECTO

---

## Scorecard (1-10)

| Categoria | Score | Justificacion |
|---|---|---|
| **Arquitectura** | 9 | Next.js 15 App Router, multi-tenant RLS, pipeline async WhatsApp, 20 tablas bien normalizadas |
| **Calidad de Codigo** | 9 | TypeScript estricto, Zod validation, sin `any` types, OWASP headers en middleware |
| **Madurez AI/Agentes** | 10 | Pipeline completo: Intent Classifier (GPT-5-nano) → Model Router → RAG (pgvector) → Guardrails por industria → Response. 15 marketplace agents autonomos |
| **Seguridad** | 9 | HMAC-SHA256 webhooks (timing-safe), CSRF, RLS multi-tenant, rate limiting Upstash Redis, audit logs, secret encryption |
| **Escalabilidad** | 9 | Serverless Vercel, Redis caching, multi-tenant isolation, cost-optimized LLM routing ($4.50/mes 100K clasificaciones) |
| **Market Fit** | 9 | WhatsApp es EL canal en Mexico. 25+ industrias. OXXO/SPEI payments. ROI tracking por industria |
| **Documentacion** | 10 | KNOWLEDGE_CACHE.md (14KB), CLAUDE.md (129 paginas), schema.sql comentado, AGENTS.md |
| **Testing** | 5 | Vitest configurado con tests en `lib/llm/__tests__` y `lib/whatsapp/__tests__`, pero coverage minimo |
| **DevOps/Infra** | 9 | 6 cron jobs en Vercel, webhook logging table, health checks, Vercel Pro |
| **Innovacion** | 9 | Guardrails crisis psicologica (Linea de la Vida), voice AI con Retell/ElevenLabs/Deepgram, ad attribution WhatsApp |
| **TOTAL** | **88/100** | |

---

## Fortalezas Principales

1. **Unico con marketplace de agentes autonomos** — 15 agentes pre-construidos (Cobrador $499, Resenas $299, Lead Scoring $399, etc.) que corren por cron/evento sin intervencion humana
2. **Pipeline AI mas sofisticado de los 3 proyectos** — Classifier → Router → RAG → Guardrails → Response es production-grade
3. **Guardrails por industria** — Medico: prohibe diagnosticos. Psicologia: protocolo crisis con numeros de emergencia. Dental: fuerza citas ante dolor agudo
4. **Multi-canal real** — WhatsApp + Voice (Retell AI) + Web playground
5. **Revenue model claro** — Agentes con precio, planes por tier, tracking de costos por mensaje

---

## Top 5 Mejoras Recomendadas

### 1. Testing (CRITICO) — Score actual: 5/10
**Problema:** Vitest configurado pero coverage < 20%. El pipeline WhatsApp processor es el core del negocio y tiene tests minimos.

**Accion:**
- Agregar tests unitarios para `lib/whatsapp/processor.ts` (min 10 test cases: mensaje texto, audio, imagen, intent classification, model selection, guardrail validation)
- Agregar tests para `lib/llm/classifier.ts` y `lib/guardrails/validate.ts`
- Usar MSW (Mock Service Worker) para mock de OpenRouter y WhatsApp Cloud API
- Meta: 80% coverage en `src/lib/`
- Agregar CI check: `vitest run --coverage` en pre-push hook

### 2. Webhook Retry con Backoff Exponencial
**Problema:** Si WhatsApp Cloud API falla al enviar, el mensaje se pierde. No hay cola de reintentos.

**Accion:**
- Implementar Upstash QStash como cola de mensajes
- Retry: 3 intentos con backoff (2s, 8s, 32s)
- Dead letter queue para mensajes fallidos persistentes
- Dashboard en `/webhooks` para ver mensajes fallidos y re-enviar manualmente

### 3. Rate Limiting Per-Tenant
**Problema:** Rate limiting actual es global. Un tenant que envie spam puede afectar a todos.

**Accion:**
- Modificar `lib/rate-limit.ts` para incluir `tenant_id` en la key de Redis
- Limites por plan: Basico (100 msg/hr), Pro (500 msg/hr), Enterprise (2000 msg/hr)
- Responder 429 con `Retry-After` header
- Agregar metricas de rate limit al dashboard de analytics

### 4. OpenAPI Documentation
**Problema:** 30+ endpoints sin documentacion formal. Partners e integraciones futuras necesitan spec.

**Accion:**
- Agregar `swagger-jsdoc` + `swagger-ui-react` 
- Documentar todos los endpoints en `/api/docs`
- Incluir ejemplos de request/response, codigos de error, autenticacion
- Generar SDK clients automaticamente con `openapi-generator`

### 5. Observability & Monitoring
**Problema:** Sin error tracking centralizado ni product analytics.

**Accion:**
- Agregar Sentry para error tracking (capturar errores de WhatsApp processor, LLM failures)
- Agregar PostHog para product analytics (funnel onboarding, feature usage, churn signals)
- Crear alertas: >5% error rate en webhooks, LLM latency > 5s, cron job failures
- Dashboard de salud del sistema en `/admin/health`

---

## Oportunidades de Expansion de Agentes

El marketplace actual tiene 15 agentes. Agentes adicionales de alto valor:

| Agente | Trigger | Descripcion | Precio |
|---|---|---|---|
| **Encuestas Post-Servicio** | Evento: cita completada | Envia encuesta NPS 2 horas despues de la cita. Recopila feedback, detecta insatisfaccion | $249/mes |
| **Recuperador de Carritos** | Evento: conversacion abandonada | Si cliente pregunto precios pero no agendo en 24hrs → seguimiento automatico | $399/mes |
| **Reporte Semanal** | Cron lunes 8am | Email al dueno: top metricas, conversaciones sin resolver, revenue estimado, sugerencias AI | $199/mes |
| **Detector de Oportunidades** | Evento: nuevo mensaje | Analiza mensajes para detectar upsell: "Tambien ofrecemos blanqueamiento dental" si preguntaron por limpieza | $449/mes |
| **Gestor de Inventario** | Cron diario | Para restaurantes: alerta cuando items del menu tienen stock bajo segun patrones de pedidos | $349/mes |
