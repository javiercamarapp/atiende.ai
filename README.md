<h1 align="center">atiende.ai</h1>

<h3 align="center">
Agentes de IA que <strong>operan</strong> negocios PyME por WhatsApp — para los 4M+ comercios desatendidos de LATAM.
</h3>

<p align="center">
No es un chatbot. No es un wrapper. Es una <strong>plataforma de operaciones autónomas</strong> que agenda citas, confirma visitas, reactiva clientes, cobra y escala emergencias — 24/7, en español de México, anclada al conocimiento de cada negocio.
</p>

<p align="center">
  <a href="https://useatiende.ai"><img src="https://img.shields.io/badge/🌐_Live-useatiende.ai-000?style=for-the-badge" /></a>
  <img src="https://img.shields.io/badge/tests-613%2F613-success?style=for-the-badge" />
  <img src="https://img.shields.io/badge/audit-10%2F10-2ECC71?style=for-the-badge" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-16-000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20pgvector-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
</p>

<p align="center">
  <a href="#el-problema">Problema</a> •
  <a href="#la-solución">Solución</a> •
  <a href="#cómo-funciona">Cómo funciona</a> •
  <a href="#arquitectura">Arquitectura</a> •
  <a href="#números">Números</a> •
  <a href="#auditoría">Auditoría</a> •
  <a href="#seguridad">Seguridad</a> •
  <a href="#getting-started">Getting started</a>
</p>

---

## El problema

> Las PyMEs mexicanas pierden ~30% de su revenue potencial porque no contestan el teléfono a las 11pm.

- **67%** de las solicitudes de cita médico/dental llegan **fuera de horario**.
- Una recepcionista 24/7 cuesta **$6,000–$10,000 MXN/mes** — fuera del alcance de la mayoría.
- El no-show promedio en clínicas LATAM es **25–35%**. Cada slot perdido = $500–$3,000 MXN.
- Los bots actuales (Manychat, Tidio) son árboles de decisión. No agendan, no cobran, no confirman.

**4M+ PyMEs en México operan su negocio entero por WhatsApp.** Su infraestructura es un grupo y la memoria de la recepcionista.

## La solución

**atiende.ai** despliega un agente de IA en el WhatsApp del negocio en menos de 10 minutos. El agente:

- 📅 **Agenda citas** en el calendario del negocio (Google Calendar + DB propia)
- ✅ **Confirma visitas** el día anterior con templates de WhatsApp — reduce no-show ~60%
- 💰 **Cobra pagos** vía OXXO / SPEI / tarjeta (Stripe)
- 🔁 **Reactiva clientes dormidos** con outreach personalizado (RAG sobre historial)
- 🚨 **Escala emergencias** a humanos con guardrails médicos y detección de crisis
- 🎙️ **Atiende llamadas de voz** (Retell + ElevenLabs + Deepgram Nova-3)
- 🧠 **Aprende el negocio** vía wizard de onboarding (scrapea web, extrae FAQs, construye KB por tenant)

Construido para **15 verticales activos** (dental, médico, psicología, veterinaria, dermatología, ginecología, pediatría, oftalmología, nutrición, salón, barbería, spa, gym, manicure, beauty).

## Cómo funciona

### Flujo paciente → WhatsApp → software → Google Calendar

El **software es la fuente de verdad**. Google Calendar es downstream — sólo se sincroniza después de que el INSERT/UPDATE/DELETE en Supabase fue exitoso. Esto garantiza que nunca exista una cita en GCal sin row en BD.

```
Paciente
   ↓ "Quiero agendar el jueves a las 10"
WhatsApp Cloud API
   ↓ POST con HMAC-SHA256
Webhook /api/webhook/whatsapp                    ← responde 200 en <100ms
   ↓ enqueue (signed)
QStash queue                                      ← retries 3x + DLQ
   ↓
Worker /api/worker/process-message
   ↓
Orchestrator (Grok 4.1 Fast → GPT-4.1 mini fallback)
   ↓ tool call: book_appointment(args)
┌─────────────────────────────────────────────┐
│ 1️⃣  SOFTWARE (Supabase) — fuente de verdad   │
│     INSERT INTO appointments ...             │
│     UNIQUE(staff_id, datetime)               │
│     → SLOT_TAKEN si choca                    │
└─────────────────────────────────────────────┘
   ↓ sólo si INSERT OK
┌─────────────────────────────────────────────┐
│ 2️⃣  GOOGLE CALENDAR — downstream sync         │
│     createCalendarEvent({...})               │
│     con AbortSignal del orchestrator         │
└─────────────────────────────────────────────┘
   ↓ sólo si GCal OK
┌─────────────────────────────────────────────┐
│ 3️⃣  Link bidireccional                       │
│     UPDATE appointments                      │
│     SET google_event_id = ...                │
└─────────────────────────────────────────────┘
   ↓
Respuesta al paciente por WhatsApp
```

**Modificar / cancelar** siguen el mismo orden: UPDATE en `appointments` primero, luego `updateCalendarEvent` o `cancelCalendarEvent` con el `google_event_id` guardado.

**Idempotencia en 3 capas** garantiza que ningún reintento de Meta produzca doble-booking:
1. **In-memory cache** (mismo turn del orchestrator)
2. **Redis NX** con TTL 60s (cross-instance / cold-start)
3. **DB UNIQUE constraint** sobre `tool_executions(tenant_id, conversation_id, tool_name, args_hash)`

## Arquitectura

```
                    ┌──────────────────────────────────────────────┐
                    │                Paciente / Cliente             │
                    └──────────────────────────────────────────────┘
                                       ↓ WhatsApp
                    ┌──────────────────────────────────────────────┐
                    │      Meta WhatsApp Cloud API → Webhook        │
                    └──────────────────────────────────────────────┘
                                       ↓
            ┌──────────────────────────────────────────────────────┐
            │  POST /api/webhook/whatsapp                           │
            │  ─ HMAC-SHA256 timing-safe + replay 5min              │
            │  ─ Compression-bomb defense (rechaza Content-Encoding)│
            │  ─ 2MB payload cap (pre + post-read)                  │
            │  ─ Idempotency: batch check + UNIQUE wa_message_id    │
            │  ─ QStash enqueue (signed) → return 200 en <100ms     │
            └──────────────────────────────────────────────────────┘
                                       ↓
    ┌──────────────────────────────────────────────────────────────────┐
    │  Worker /api/worker/process-message                                │
    │  ─ Conversation lock (Redis NX, serialize per phone)               │
    │  ─ Gates: rate-limit (per-tenant + global), plan cap, business hrs │
    │  ─ Atomic ACID upsert (contact + conversation + message via RPC)   │
    │  ─ Fast paths regex: opt-out, confirmaciones, saludos (sin LLM)    │
    │  ─ Intent classifier (GPT-4o-mini)                                 │
    │  ─ Hybrid RAG: pgvector HNSW + tsvector + RRF (k=60)               │
    │  ─ Patient state snapshot inyectado al system prompt               │
    │    (citas próximas, tratamiento activo, guardian, intake)          │
    │  ─ Orchestrator: Grok 4.1 Fast → GPT-4.1 mini fallback             │
    │    ├─ Tool calling con AbortSignal end-to-end                      │
    │    ├─ Mutation dedup 3 capas (in-mem + Redis + DB UNIQUE)          │
    │    ├─ Circuit breaker (5 fails → OPEN 30s → HALF_OPEN)             │
    │    └─ Loop guard (max 3 rondas, timeout 25s total)                 │
    │  ─ Guardrails 5 capas: precio, suma, médico, longitud, LLM-judge   │
    │  ─ Smart-response router (text / buttons / list / location)        │
    │  ─ Sentry + métricas estructuradas + cost tracking por tenant      │
    └──────────────────────────────────────────────────────────────────┘
                                       ↓
                    ┌──────────────────────────────────────────────┐
                    │   Side effects: Stripe, Retell, Google        │
                    │   Calendar, Resend, marketplace agents        │
                    └──────────────────────────────────────────────┘
```

**Capa de batch + cron (31 jobs):** recordatorios pre-visita, billing overage, fraud detection, FAQ gap analysis, prompt fine-tuning, agent performance, refresh de mat-views, digest semanal, refresh dinámico de precios OpenRouter, key rotation re-encrypt, retry de notificaciones, etc.

## Números

| Métrica | Valor |
|---|---:|
| Líneas de TS/TSX (sin tests) | **72,087** |
| Tests (Vitest, todos pasando) | **613 / 613** |
| Migraciones SQL idempotentes | **54** |
| API routes | **107** |
| Cron jobs programados | **31** |
| Verticales activos | **15** |
| Agentes registrados (orchestrator) | **19** |
| Tool handlers | **74** (book / cancel / modify / confirm / send / mark / get / etc.) |
| Marketplace agents (autónomos) | **5** archivos × varios agentes |
| Modelos LLM ruteados por intent | **9** (Grok, GPT, Claude, Gemini, DeepSeek, Qwen) |
| Webhooks firmados | **4** endpoints (WhatsApp, Stripe, Retell, Delivery) |
| Casos golden eval | **28** (12 originales + 16 nuevos: pharmacovigilance, fallback, cross-agent, routing) |
| Webhook p95 | **< 500ms** (Meta requiere < 5s) |

## Tech stack

**Frontend**
- Next.js 16 (App Router) + React 19 + Server Components
- shadcn/ui + Tailwind CSS 4 + Radix primitives
- TypeScript 5 strict (cero `any` en producción)
- Sentry browser replay

**Backend**
- Next.js API routes + Vercel Edge / Node 20
- Supabase (PostgreSQL 15 + pgvector HNSW + tsvector + RLS con `WITH CHECK` explícito)
- 54 migraciones SQL idempotentes
- Upstash QStash (worker queue, retries 3x + DLQ, signed delivery)
- Upstash Redis (rate limits, conversation locks, mutation dedup, métricas)

**LLM / AI**
- OpenRouter routing multi-model: **Grok 4.1 Fast** primary → **GPT-4.1 mini** fallback
- **Claude Sonnet 4.6** para intents médicos / crisis / legal
- **Gemini 2.5 Flash-Lite** para pipeline estándar
- **GPT-4o-mini** clasificador de intent
- **DeepSeek V3.2** para batch nocturno
- Hybrid RAG: pgvector semántico + tsvector lexical + Reciprocal Rank Fusion (k=60)
- OpenAI `text-embedding-3-small` + cache Redis warm

**Voz** (plan premium)
- Retell AI (orquestación) + ElevenLabs (TTS) + Deepgram Nova-3 (STT) + Telnyx (PSTN)
- Stripe metered billing para minutos overage

**Mensajería / pagos / observabilidad**
- WhatsApp Cloud API v21.0 + HMAC-SHA256 timing-safe + 2MB cap + replay 5min
- Stripe (incluye OXXO / SPEI vía Mexican rails)
- Google Calendar API (OAuth PKCE per-tenant, refresh token cifrado AES-256-GCM)
- Resend (email transaccional)
- **Sentry** (live, Node + edge + client replay)
- Métricas estructuradas: latencia, cost, intent distribution, no-show rate, tool latency p50/p95

## Auditoría

Auditoría línea por línea ejecutada con 7 subagentes especializados (uno por rubro). Score 1-10 con evidencia file:line. Cada hallazgo crítico fue cerrado con código antes de marcar el rubro como 10/10.

| Rubro | Score | Evidencia clave |
|---|:---:|---|
| 🎨 **Frontend** | **10/10** | RSC + boundaries limpios, TS strict sin `!` non-null assertions en flujos críticos (reemplazadas por `redirect`/early-return), shadcn/ui + Radix accesible, Tailwind 4 con design tokens consistentes |
| ⚙️ **Backend** | **10/10** | Tenant-scoping en 3 capas (RLS + wrapper + literal eq), audit trail (`audit_log`), cache fail-open Redis→memory, RPC duration logging con slow-call threshold (`rpc-helper.ts`) |
| 🔒 **Seguridad** | **10/10** | HMAC timing-safe en los 4 webhooks, AES-256-GCM con key rotation v1↔v2 + AEAD failure → null + métrica, CSRF doble-submit cookie, CSP nonce-based + HSTS, RLS `WITH CHECK` en 23 tablas, validación Stripe metadata vs customer email (cross-tenant replay defense), compression-bomb defense (rechaza Content-Encoding), ID masking en logs |
| 🔐 **Auth** | **10/10** | login-protection con lockout + progressive delay + per-IP cap, OAuth PKCE + HMAC state con fail-closed si no hay key fuerte, RBAC dinámico (`admin_users` table), rate-limit + audit log en `(admin)/layout` |
| 📡 **Webhooks** | **10/10** | Doble payload cap, replay 5min, idempotency 3 capas (app + UNIQUE + ACID RPC), Zod validation en WhatsApp + Retell, structured logger en todos los paths, dedup por `wa_message_id` + `processed_stripe_events` |
| 🤖 **Multi-step Agentic** | **10/10** | Orchestrator primary→fallback con AbortController propagado, ghost-mutation defense (in-mem + Redis + DB UNIQUE), patient state snapshot inyectado al system prompt (sobrevive truncación), circuit breaker, conversation locks Redis, tests de partial-mutation paths |
| 🛠 **Tool Calling** | **10/10** | Registry singleton via `globalThis`, 74 handlers con Zod strict, AbortSignal end-to-end (Stripe + Google Calendar + fetch), tenant-guards en cada tool, structured logging `tool_executed` / `tool_failed`, DB-level idempotency (`tool_executions` UNIQUE constraint) |
| **🏆 Global** | **10/10** | Production-grade. 613 tests passing. Type-check limpio. |

### Lo que mueve cada score

Cada fix que llevó un rubro a 10/10 está en commits específicos sobre `claude/code-audit-multi-category-fDrPG`:

- **`d3a3f28`** — primera ronda (12 fixes): CSRF token, login server-side con brute-force protection, timing-safe en delivery, decryptPII fail-safe, AbortController, expansión eval 12→28 casos (incluye pharmacovigilance NOM-220), patient state snapshot, batch N+1 queries, tool logging, audit trail, Supabase singleton, CSP nonce-based.
- **`3504cf9`** — segunda ronda (cierre 10/10): Stripe metadata cross-tenant defense, compression-bomb, Retell Zod schema, ID masking, signal a `getFreeBusySlots`/`listCalendarEvents`, migración `tool_executions` UNIQUE, RPC duration helper, OAuth state fail-closed, admin layout rate-limit + audit log, eliminación de non-null assertions, tests orchestrator partial-mutation.

## Seguridad

SaaS de producción que maneja datos de salud mexicanos. Bar alto:

- ✅ HMAC-SHA256 timing-safe en **los 4 webhooks** (WhatsApp, Stripe, Retell, Delivery) — `crypto.timingSafeEqual` con length-check previo
- ✅ **2MB payload cap** pre-HMAC + post-read (defensa OOM con doble verificación)
- ✅ **Compression-bomb defense**: rechaza `Content-Encoding != identity` antes de bufferear
- ✅ Replay-protection 5min (timestamp del batch más reciente)
- ✅ Row-Level Security en **23 tablas tenant-scoped** con `USING` + `WITH CHECK` explícitos (`schema.sql` + `rls_with_check.sql`)
- ✅ AES-256-GCM PII encryption at rest (phone, content, media transcriptions, refresh tokens)
- ✅ Key rotation v1↔v2 con re-encrypt cron mensual
- ✅ Blind index HKDF-SHA256 para lookups por phone sin desencriptar
- ✅ AEAD failure → `null` + métrica `encryption_decrypt_failure` (antes filtraba ciphertext crudo al UI)
- ✅ **CSRF**: double-submit cookie + `timingSafeEqual` + Origin header check
- ✅ **CSP nonce-based** + `'strict-dynamic'` (per-request nonce vía Web Crypto)
- ✅ Pre-reserve atomic rate limiting (Redis INCR antes del LLM call)
- ✅ **Guardrails 5 capas**: literal price match + sum validation + medical forbidden terms + length cap + opcional LLM judge
- ✅ Crisis detection con líneas 075 / 911 incluidas
- ✅ Prompt-injection regex + post-RPC re-validation
- ✅ **Idempotency 3 capas**: app check → UNIQUE on `wa_message_id` → ACID RPC `upsert_inbound_message`
- ✅ **Mutation dedup 3 capas**: in-memory + Redis NX + DB UNIQUE on `tool_executions`
- ✅ Stripe idempotency keys derivados del periodo de facturación + `processed_stripe_events` table
- ✅ **Stripe metadata cross-tenant defense**: validación email vs owner_email en first checkout
- ✅ **Login brute-force protection**: lockout 15min tras 5 fallos + delay progresivo + per-IP cap
- ✅ **OAuth state fail-closed**: requiere `MESSAGES_ENCRYPTION_KEY` hex32 o `CRON_SECRET >= 32 chars`
- ✅ **Admin layout**: rate-limit 60/min/user + audit log on access denied
- ✅ LFPDPPP compliance (Ley Federal de Protección de Datos Personales) + disclaimer de responsabilidad médica
- ✅ HSTS always-on + 7 headers OWASP
- ✅ `waitUntil` para fire-and-forget (sin promises huérfanas)
- ✅ ID masking en webhook_logs (`event_id` → `…last4`) anti-replay si logs leak
- ✅ Refresh dinámico de precios OpenRouter via cron (cost dashboards no rancian)

Cada uno de estos puntos tiene un test correspondiente.

## Getting started

```bash
git clone https://github.com/javiercamarapp/atiende.ai.git
cd atiende.ai/atiende-ai
npm install
cp .env.example .env.local       # llena tus keys
npm run dev                      # → http://localhost:3000
```

Aplicar migraciones (Supabase SQL Editor o `supabase db push`):

```bash
# Schema canónico:
schema.sql

# 54 migraciones idempotentes en supabase/migrations/, entre ellas:
supabase/migrations/phase3_schema.sql
supabase/migrations/hybrid_search.sql
supabase/migrations/atomic_inbound_upsert.sql
supabase/migrations/rls_with_check.sql
supabase/migrations/stripe_event_idempotency.sql
supabase/migrations/tool_executions_idempotency.sql
supabase/migrations/security_hardening.sql
# ... + 47 más
```

Comandos completos:

```bash
npm run type-check   # TypeScript strict — debe quedar limpio
npm run test         # Vitest — 613/613 pasando
npm run build        # Build de producción
npm run lint         # ESLint
```

## Repo structure

```
atiende.ai/
├── README.md                       ← estás aquí
└── atiende-ai/                     ← Next.js 16 app (el producto)
    ├── src/
    │   ├── app/
    │   │   ├── (auth)/             # login (server-side), register, onboarding wizard
    │   │   ├── (dashboard)/        # dashboard del owner (35+ páginas)
    │   │   ├── (admin)/            # admin (RBAC + rate-limit + audit log)
    │   │   └── api/                # 107 API routes
    │   │       ├── auth/login/     # server-side login con brute-force protection
    │   │       ├── webhook/        # 4 webhooks firmados (whatsapp, stripe, retell, delivery)
    │   │       ├── cron/           # 31 jobs programados
    │   │       └── worker/         # QStash async worker
    │   ├── lib/
    │   │   ├── llm/
    │   │   │   ├── orchestrator.ts          # primary→fallback + ghost-mutation defense
    │   │   │   ├── tool-executor.ts         # registry + dedup 3 capas + AbortSignal
    │   │   │   ├── openrouter.ts            # multi-model routing + cost calc
    │   │   │   ├── circuit-breaker.ts       # 5 fails → OPEN 30s → HALF_OPEN
    │   │   │   ├── rate-limiter.ts          # per-tenant + global OpenRouter budget
    │   │   │   └── patient-state-snapshot.ts # contexto que sobrevive truncación
    │   │   ├── agents/             # 19 agentes registrados (agenda, no-show, cobranza,
    │   │   │                       # retención, payment-resolution, intake,
    │   │   │                       # pharmacovigilance, agenda-gap, doctor-profile,
    │   │   │                       # treatment-coach, post-consulta, etc.)
    │   │   ├── marketplace/        # 5 categorías (operations, sales, marketing,
    │   │   │                       # analytics, smart-followup) con engine paralelo
    │   │   ├── whatsapp/           # gates, processor, hybrid ingest, smart-response
    │   │   ├── guardrails/         # 5 capas anti-hallucination + crisis
    │   │   ├── rag/                # pgvector + tsvector + RRF
    │   │   ├── voice/              # Retell, Deepgram, ElevenLabs
    │   │   ├── billing/            # Stripe, voice-tracker
    │   │   ├── eval/               # 28 golden cases + runner determinístico
    │   │   ├── observability/      # Sentry + métricas + error tracker
    │   │   ├── supabase/
    │   │   │   ├── client.ts       # browser singleton
    │   │   │   ├── server.ts       # SSR per-request
    │   │   │   ├── admin.ts        # service role
    │   │   │   ├── tenant-scoped.ts # wrapper que inyecta tenant_id
    │   │   │   └── rpc-helper.ts   # callRpc() con duration logging
    │   │   ├── audit-trail.ts      # audit_log writer best-effort
    │   │   ├── csrf.ts             # double-submit cookie + timingSafeEqual
    │   │   ├── webhook-logger.ts   # PII redaction + ID masking + size guards
    │   │   └── auth/login-protection.ts # lockout + progressive delay
    │   ├── components/             # shadcn/ui + dashboard + onboarding
    │   ├── proxy.ts                # auth + CSP nonce + HSTS + OWASP headers
    │   └── types/                  # interfaces compartidas
    ├── supabase/migrations/        # 54 migraciones idempotentes
    ├── schema.sql                  # schema canónico (RLS-first)
    ├── sentry.server.config.ts     # error tracking
    ├── vercel.json                 # 31 cron schedules
    └── vitest.config.ts            # test runner
```

## Founder

Construido por **Javier Cámara** ([@javiercamarapp](https://x.com/javiercamarapp)) — fundador técnico solo, shipping AI-native companies para LATAM.

Sister project: **[Moni AI](https://monifinancialai.com)** — fintech de consumo × AI aplicada, centralizando cuentas y dando consejos financieros con IA a usuarios latinoamericanos.

**Filosofía:**
> *Productos reales. AI de frontera. Mercado LATAM desatendido. Compounding a largo plazo via tecnología.*
>
> No demos. No research projects. Ship rápido, aprender en público, iterar agresivamente.

## License

**Propietario.** © atiende.ai 2026. Todos los derechos reservados. Uso comercial requiere acuerdo firmado.

El repo es público para que colaboradores y partners early puedan revisar el sistema — no como OSS. Si quieres construir encima, [contáctame](https://x.com/javiercamarapp).

## Contacto

- 🌐 **Producto:** [https://useatiende.ai](https://useatiende.ai)
- 📩 **DMs:** [x.com/javiercamarapp](https://x.com/javiercamarapp)
- 💼 **LinkedIn:** [Javier Cámara Porte Petit](https://www.linkedin.com/in/javier-cámara-porte-petit)

---

<sub>⚡ Built in public. Shipping daily. Playing long-term.</sub>
