<h1 align="center">atiende.ai</h1>

<p align="center">
  <strong>AI agents that run SME operations on WhatsApp — built for LATAM's 4M+ underserved businesses.</strong>
</p>

<p align="center">
  <a href="https://useatiende.ai">Live Demo</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#security">Security</a> &bull;
  <a href="#getting-started">Getting Started</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tests-513%2F513%20passing-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/Supabase-pgvector%20%2B%20RLS-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Sentry-monitored-362D59?style=flat-square&logo=sentry&logoColor=white" />
  <img src="https://img.shields.io/badge/license-proprietary-lightgrey?style=flat-square" />
</p>

---

## The Problem

A large share of appointment requests in Mexican SMEs arrive outside business hours (internal estimate based on customer interviews, pending published baseline). Clinics, salons, and service businesses lose potential customers because nobody answers WhatsApp at 11pm, and hiring a 24/7 receptionist costs $6,000+ MXN/month — prohibitive for most SMEs.

## The Solution

atiende.ai deploys a production-grade AI agent on a business's WhatsApp in **under 10 minutes**. The agent books appointments, answers FAQs, confirms visits, reactivates dormant clients, and escalates emergencies — all trained on the business's own knowledge via RAG with anti-hallucination guardrails.

**15 active verticals** across healthcare (dental, medical, psych, derma, vet, nutrition, OB/GYN, ophthalmology, pediatrics) and beauty/wellness (salons, barbershops, spas, gyms, nail studios, aesthetics). 40+ verticals on roadmap.

<h2 id="architecture">Architecture</h2>

```
Customer WhatsApp Message
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/webhook/whatsapp                                 │
│  HMAC-SHA256 verify → 2MB payload cap → QStash async queue  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker: processIncomingMessage                             │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │ Gates    │──▶│ Orchestrator │──▶│ Tool-calling     │    │
│  │ (rate    │   │ (Grok 4.1    │   │ agents (30+      │    │
│  │  limit,  │   │  Fast +      │   │ tools, book/     │    │
│  │  quota,  │   │  GPT-4.1     │   │ cancel/confirm/  │    │
│  │  hours)  │   │  fallback)   │   │ escalate/pay)    │    │
│  └──────────┘   └──────┬───────┘   └──────────────────┘    │
│                         │                                    │
│  ┌──────────┐   ┌──────┴───────┐   ┌──────────────────┐    │
│  │ Hybrid   │   │ 5-layer      │   │ Smart Response   │    │
│  │ RAG      │──▶│ guardrails   │──▶│ (buttons, lists, │    │
│  │ (vector  │   │ (price/      │   │  location,       │    │
│  │  + BM25  │   │  medical/    │   │  split, i18n)    │    │
│  │  + RRF)  │   │  crisis/     │   └──────────────────┘    │
│  └──────────┘   │  length/     │                            │
│                  │  LLM-judge)  │                            │
│                  └──────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| **UI** | shadcn/ui + Tailwind CSS 4 |
| **Database** | Supabase (PostgreSQL 15 + pgvector HNSW + RLS on 23 tables) |
| **LLM Orchestration** | OpenRouter — Grok 4.1 Fast (primary), GPT-4.1-mini (fallback), Claude Sonnet 4.6 (crisis/sensitive), Gemini Flash-Lite (standard), DeepSeek V3.2 (batch) |
| **Voice** | Retell AI (STT/TTS orchestrator — internally uses ElevenLabs and Deepgram) + Telnyx (SIP/number) + Deepgram Nova-3 (direct, for WhatsApp audio transcription) |
| **Messaging** | WhatsApp Cloud API v21.0 + HMAC-SHA256 |
| **Queue** | Upstash QStash (async webhooks, DLQ, retries) |
| **Cache** | Upstash Redis (rate-limit, monthly quotas, model price cache) |
| **Payments** | Stripe (MXN, metered billing for voice overage, supports card + OXXO + SPEI via Stripe Mexico) |
| **Observability** | Sentry + structured JSON logs + per-tenant metrics |
| **Deploy** | Vercel Pro + 25 cron jobs (Hobby plan caps at 2 — Pro required) |

## Key Numbers

| Metric | Value |
|---|---:|
| Lines of production TypeScript | 46,500+ |
| Tests passing | 513/513 |
| Active verticals | 15 |
| Autonomous marketplace agents | 25 |
| Tool-call handlers registered | 30+ |
| LLM models in production routing | 9 |
| SQL migrations applied | 27 |
| Webhook endpoints (HMAC-verified) | 5 |

<h2 id="security">Security Posture</h2>

Production SaaS handling medical appointment data = bar is high.

- HMAC-SHA256 signature verification on all 5 webhook endpoints + 2MB payload size cap
- Row-Level Security on 23 tenant-scoped tables with explicit `WITH CHECK`
- Tenant-scoped admin wrapper (`getTenantScopedAdmin`) as defense-in-depth over RLS
- AES-256-GCM encryption at rest for message bodies (`messages.content`) and media transcriptions. Contact phone/name encryption is tracked in the roadmap — current protection is RLS + tenant-scoped admin wrapper
- Atomic monthly quota pre-reservation (Redis INCR before LLM call, not after)
- Tool-call mutation cache (defense-in-depth against ghost mutations in LLM fallback)
- 5-layer anti-hallucination guardrails: price validation (sum-aware), medical blocklist, crisis detection (SAPTEL/911 hotlines), length cap, optional LLM-judge
- Prompt injection detection + input sanitization
- Idempotency at 3 layers: app check + UNIQUE constraint + ACID RPC (`upsert_inbound_message`)
- LFPDPPP compliance (Mexican data protection) + medical disclaimer injection
- CSP with domain allowlist + HSTS always-on + 7 OWASP headers
- PII redaction in all webhook logs

<h2 id="getting-started">Getting Started</h2>

```bash
git clone https://github.com/javiercamarapp/atiende.ai.git
cd atiende.ai/atiende-ai
cp .env.example .env.local   # Fill in your keys
npm install
npm run dev                   # http://localhost:3000
```

### Commands

```bash
npm run dev           # Dev server (Next.js 15)
npm run build         # Production build
npm run test          # Run all 513 tests (Vitest)
npm run type-check    # TypeScript strict check
npm run lint          # ESLint
```

## Project Structure

```
atiende-ai/
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/              # Login, register, forgot password
│   │   ├── (dashboard)/         # Business owner dashboard
│   │   └── api/                 # 35+ API routes
│   │       ├── webhook/         # WhatsApp, Stripe, Retell, Delivery
│   │       ├── cron/            # 25 scheduled jobs
│   │       └── onboarding/      # 6-step AI-guided setup
│   ├── lib/
│   │   ├── agents/              # 10 agent modules (agenda, no-show, FAQ, intake, etc.)
│   │   ├── llm/                 # Orchestrator, tool-executor, OpenRouter routing
│   │   ├── whatsapp/            # Processor, gates, smart-response, opt-out, inbound-upsert
│   │   ├── guardrails/          # Anti-hallucination, crisis detection, price validation
│   │   ├── rag/                 # Hybrid search (pgvector + tsvector + RRF)
│   │   ├── eval/                # Golden dataset + synthetic eval runner
│   │   ├── billing/             # Stripe subscriptions + metered voice overage
│   │   ├── intelligence/        # Sentiment, journey, predictive, feedback loop
│   │   ├── marketplace/         # 25 autonomous agents (cron/event-triggered)
│   │   └── observability/       # Sentry, metrics, error tracker
│   └── components/              # React UI (shadcn + dashboard + onboarding chat)
├── schema.sql                   # PostgreSQL schema (23 tables + RLS + functions)
├── supabase/migrations/         # 27 SQL migrations (idempotent)
├── .github/workflows/ci.yml     # CI: lint → type-check → test → build
└── vercel.json                  # 25 cron job schedules
```

## Security & Compliance Roadmap

Known gaps being tracked (honest inventory, not marketing):

1. **Full PII encryption** — currently only `messages.content` and media transcriptions are encrypted at rest. `contacts.phone`, `contacts.name`, `appointments.customer_phone`, `conversations.customer_phone` are plaintext. RLS + tenant-scoped admin wrapper is the current boundary; field-level encryption with backfill is the planned hardening.
2. **Encryption key rotation** — envelope is `v1:` prefixed but there's no `v2` path or re-encrypt tool yet. If a key is compromised today, the recovery path is a full reset. Key versioning (`MESSAGES_ENCRYPTION_KEY_V2` + background re-encrypt cron) is planned.
3. **MFA + login lockout + login rate-limit** — Supabase Auth defaults only. For a health-data platform this is below bar; SMS/TOTP MFA and lockout counters on `auth_attempts` are planned.
4. **ARCO-S titular-facing flow** — the `/api/privacy/delete-my-data` endpoint currently only accepts the tenant owner. LFPDPPP requires the patient (titular) to be able to request erasure directly. A signed-email-token flow + `data_deletion_log` audit table is planned.
5. **INAI registration + legal review of disclaimer** — the disclaimer in `LEGAL_DISCLAIMER.md` is a template pending lawyer review; INAI registration of the data-treatment responsibility is not yet completed.
6. **Load testing** — p95 targets referenced in code comments are not backed by a published k6/artillery run. A `scripts/load/` harness is planned.
7. **CI maturity** — current pipeline is lint/type-check/test/build. Planned: `gitleaks` secret scanning, 80% coverage gate, preview-URL smoke tests, dependabot.

## CI/CD

GitHub Actions pipeline on every push to `main` and all PRs:
1. Install dependencies
2. ESLint
3. TypeScript strict check (`tsc --noEmit`)
4. Vitest (513 tests)
5. Next.js production build

## License

Proprietary. All rights reserved. &copy; atiende.ai 2026.

---

<p align="center">
  <a href="https://useatiende.ai"><strong>useatiende.ai</strong></a> &bull;
  Built by <a href="https://github.com/javiercamarapp">@javiercamarapp</a>
</p>
