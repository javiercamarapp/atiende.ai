<h1 align="center">atiende.ai</h1>

<h3 align="center">
AI agents that <strong>run</strong> SMEs on WhatsApp — for LATAM's 4M+ underserved businesses.
</h3>

<p align="center">
Not a chatbot. Not a wrapper. An <strong>autonomous operations platform</strong> that books appointments, confirms visits, re-activates dormant clients, collects payments, and escalates emergencies — 24/7, in natural Mexican Spanish, grounded on each tenant's own knowledge.
</p>

<p align="center">
  <a href="https://useatiende.ai"><img src="https://img.shields.io/badge/🌐_Live-useatiende.ai-000?style=for-the-badge" /></a>
  <img src="https://img.shields.io/badge/tests-589%2F589-success?style=for-the-badge" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-15-000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20pgvector-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Vercel-Edge-000?style=for-the-badge&logo=vercel&logoColor=white" />
</p>

<p align="center">
  <a href="#the-problem">Problem</a> •
  <a href="#the-solution">Solution</a> •
  <a href="#why-now">Why now</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#numbers">Numbers</a> •
  <a href="#security-posture">Security</a> •
  <a href="#getting-started">Getting started</a> •
  <a href="#founder">Founder</a>
</p>

---

## The problem

> Mexican SMEs lose **~30% of potential revenue** because they can't pick up the phone at 11pm.

- **67%** of dental/medical appointment requests arrive **outside business hours**.
- Hiring a 24/7 receptionist costs **$6,000–$10,000 MXN/month** — out of reach for most single-location businesses.
- No-show rates average **25–35%** in LATAM clinics. Every missed slot = $500–$3,000 MXN of forgone revenue.
- Current WhatsApp bots (Manychat, Tidio) are **decision-tree toys**. They can't book, can't collect, can't confirm. They frustrate users and drive them to call — where nobody picks up.

**4M+ SMEs in Mexico run their entire business on WhatsApp.** Their infrastructure is a shared group chat and a receptionist's memory.

## The solution

**atiende.ai** deploys a production-grade AI agent on a business's WhatsApp number in **under 10 minutes**. The agent:

- 📅 **Books appointments** in the business's real calendar (Google Calendar or Supabase-backed)
- ✅ **Confirms visits** the day before via template messages — cuts no-shows by ~60%
- 💰 **Collects payments** via OXXO/SPEI/card links (Conekta + Stripe)
- 🔁 **Re-activates dormant clients** with personalized outreach driven by RAG-grounded history
- 🚨 **Escalates emergencies** to humans with medical safety guardrails + crisis-detection
- 🎙️ **Answers voice calls** with Retell + ElevenLabs + Deepgram Nova-3 — full voicebot with interruption handling
- 🧠 **Learns the business** via a 6-step onboarding wizard that scrapes the website, extracts FAQs, and builds a per-tenant knowledge base

**Built for 15 active verticals** (dental, medical, psychology, veterinary, dermatology, gynecology, pediatrics, ophthalmology, nutrition, salon, barber, spa, gym, nail salon, beauty) with 25 more dormant (restaurants, retail, hospitality, legal — waiting for validated unit economics).

## Why now

| Enabler | Year | What changed |
|---|---|---|
| WhatsApp Cloud API | 2024 | Became stable/pricing-predictable enough for multi-tenant SaaS |
| LLM cost collapse | 2023–2026 | Grok 4.1 Fast at $0.20/$1.50 per M tokens → gross margin viable |
| Tool-calling maturity | 2024+ | Autonomous action execution (book, charge, confirm) — no longer research |
| LATAM WhatsApp penetration | 95%+ | vs 30% email. SMEs are WhatsApp-first; there's no alternative channel |

The market was waiting for all four to click simultaneously. They did.

## Architecture

```
                        ┌─────────────────────────────────────────────────┐
                        │                 Customer / Patient               │
                        └─────────────────────────────────────────────────┘
                                              ↓ WhatsApp message
                        ┌─────────────────────────────────────────────────┐
                        │      Meta WhatsApp Cloud API  →  Webhook         │
                        └─────────────────────────────────────────────────┘
                                              ↓
                ┌─────────────────────────────────────────────────────────┐
                │  POST /api/webhook/whatsapp                              │
                │  ─ HMAC-SHA256 signature verify (timing-safe)            │
                │  ─ 2MB payload cap (OOM defense)                         │
                │  ─ Publish to QStash (async worker queue)                │
                │  ─ Return 200 in <100ms (Meta SLA < 5s)                  │
                └─────────────────────────────────────────────────────────┘
                                              ↓
    ┌─────────────────────────────────────────────────────────────────────────┐
    │  Worker: /api/worker/process-message                                      │
    │  ─ Gates (rate-limit, plan cap, trial expiry, business hours)             │
    │  ─ Atomic ACID upsert (contact + conversation + message via RPC)          │
    │  ─ Fast paths (regex): opt-out, confirmations, greetings (no LLM)         │
    │  ─ Intent classifier (GPT-4o-mini)                                        │
    │  ─ Hybrid RAG: pgvector HNSW + Postgres tsvector + RRF fusion             │
    │  ─ Orchestrator: Grok 4.1 Fast primary → GPT-4.1 mini fallback            │
    │    ├─ Tool calling (30+ tools: book, cancel, modify, confirm, notify…)    │
    │    ├─ Mutation cache (defense-in-depth vs ghost-mutations)                │
    │    └─ AbortController + per-call timeouts                                 │
    │  ─ 5-layer guardrails: price hallucination, crisis, medical, length,      │
    │    optional LLM-judge                                                     │
    │  ─ Smart-response router (text vs buttons vs list vs location)            │
    │  ─ Sentry + structured metrics + per-tenant cost tracking                 │
    └─────────────────────────────────────────────────────────────────────────┘
                                              ↓
                        ┌─────────────────────────────────────────────────┐
                        │   Side effects: Stripe, Conekta, Retell,         │
                        │   Google Calendar, Resend, Marketplace agents    │
                        └─────────────────────────────────────────────────┘
```

**Batch & cron layer (25 jobs):** no-show reminders, pre-visit templates, billing overage, fraud detection, FAQ gap analysis, prompt fine-tuning, agent performance, materialized view refreshes, weekly digest, dynamic model-price refresh from OpenRouter.

## Numbers

| Metric | Value |
|---|---:|
| Production code (TS/TSX) | **55,300+ LOC** |
| Tests (Vitest, all passing) | **589 / 589** |
| Migrations (idempotent SQL) | **25** |
| API routes | **70** |
| Scheduled cron jobs | **25** |
| Active verticals | **15** |
| Marketplace agents (autonomous) | **14** registered + 5 placeholders |
| Tool handlers | **30+** (book, cancel, modify, confirm, send, mark, etc.) |
| LLM models routed by intent | **9** (Grok, GPT, Claude, Gemini, DeepSeek, Qwen) |
| Webhook p95 | **< 500ms** (Meta requires < 5s) |
| Security hardening iterations | **18** |

## Tech stack

**Frontend**
- Next.js 15 (App Router) + React 19 + Server Components
- shadcn/ui + Tailwind CSS 4 + Radix primitives
- TypeScript 5 (strict, zero `any` in production code)

**Backend**
- Next.js API Routes + Vercel Edge + Node 20
- Supabase (PostgreSQL 15 + pgvector HNSW + tsvector + RLS with explicit `WITH CHECK`)
- 25 idempotent SQL migrations, 23 tenant-scoped tables
- Upstash QStash (async worker queue, dead-letter retries, signed webhooks)
- Upstash Redis (sliding-window rate limits, conversation locks, atomic quota pre-reserve)

**LLM / AI**
- OpenRouter multi-model routing: **Grok 4.1 Fast** primary → **GPT-4.1 mini** fallback
- **Claude Sonnet 4.6** for medical/crisis/legal intents (non-negotiable)
- **Gemini 2.5 Flash-Lite** for standard pipeline (cheap workhorse)
- **GPT-4o-mini** intent classifier
- **DeepSeek V3.2** for nightly batch intelligence
- Hybrid RAG: pgvector semantic + tsvector lexical + **Reciprocal Rank Fusion** (k=60)
- OpenAI `text-embedding-3-small` ($0.02/M tokens) + Redis warm cache

**Voice** (Premium plan)
- Retell AI (orchestration) + ElevenLabs (TTS) + Deepgram Nova-3 (STT) + Telnyx (PSTN)
- Stripe metered billing for overage minutes

**Messaging / payments / observability**
- WhatsApp Cloud API v21.0 + HMAC-SHA256 + 2MB payload cap
- Stripe + Conekta (OXXO/SPEI Mexican rails)
- Google Calendar API (per-tenant OAuth)
- Resend (transactional email)
- **Sentry** (live, Node + edge + client replay)
- 25+ per-tenant structured metrics (latency, cost, intent distribution, no-show rate)

## Security posture

Production SaaS handling Mexican health data. The bar is high:

- ✅ HMAC-SHA256 signature verification on **all 5 webhook endpoints** (WhatsApp, Stripe, Conekta, Retell, Delivery) with **timing-safe equal**
- ✅ **2MB payload cap** pre-HMAC (OOM defense, explicit content-length + post-read check)
- ✅ Row-Level Security on **23 tenant-scoped tables** with explicit `USING` + `WITH CHECK`
- ✅ AES-256-GCM PII encryption at rest (phone, content, media transcriptions)
- ✅ **Pre-reserve atomic rate limiting** (Redis INCR before LLM call — no burst-cap bypass)
- ✅ **5-layer anti-hallucination**: literal price match + sum validation + medical forbidden terms + length + optional LLM judge (gemini-flash-lite, gated by `ENABLE_LLM_JUDGE=true`)
- ✅ Prompt-injection detection + input sanitization
- ✅ **3-layer idempotency**: app check → UNIQUE constraint on `wa_message_id` → ACID RPC `upsert_inbound_message`
- ✅ **Mutation cache** in tool-executor (defense-in-depth vs ghost-mutations on LLM fallback)
- ✅ Stripe idempotency keys derived from billing period (month-boundary-safe)
- ✅ LFPDPPP compliance (Mexican data protection) + medical liability disclaimer
- ✅ CSP with full allowlist + HSTS always-on + 7 OWASP headers
- ✅ `waitUntil` for fire-and-forget (no killed background promises)
- ✅ Dynamic OpenRouter price refresh (cron) — cost dashboards can't go stale

Every item above has a test.

## Getting started

```bash
git clone https://github.com/javiercamarapp/atiende.ai.git
cd atiende.ai/atiende-ai
npm install
cp .env.local.example .env.local   # fill in your keys
npm run dev                        # → http://localhost:3000
```

Apply SQL migrations (Supabase SQL Editor or `supabase db push`):

```bash
# Key migrations (applied in order):
supabase/migrations/phase3_schema.sql
supabase/migrations/hybrid_search.sql
supabase/migrations/atomic_inbound_upsert.sql
supabase/migrations/rls_with_check.sql
# ... + 21 more idempotent migrations
```

Full ops:

```bash
npm run type-check   # TypeScript strict pass
npm run test         # Vitest — 589/589 passing
npm run build        # Production build
npm run lint         # ESLint
```

## Repo structure

```
atiende.ai/
├── README.md                     ← you are here
└── atiende-ai/                   ← Next.js 15 app (the product)
    ├── src/
    │   ├── app/
    │   │   ├── (auth)/           # Login, register, onboarding wizard
    │   │   ├── (dashboard)/      # Owner dashboard (35+ pages)
    │   │   └── api/              # 70 API routes
    │   │       ├── webhook/      # 5 signed webhook endpoints
    │   │       ├── cron/         # 25 scheduled jobs
    │   │       └── worker/       # QStash async worker
    │   ├── lib/
    │   │   ├── agents/           # 14 autonomous agents (agenda, no-show,
    │   │   │                     #   cobranza, retención, medicamento, …)
    │   │   ├── llm/              # Orchestrator + tool-executor + routing
    │   │   ├── whatsapp/         # Gates, processor, hybrid ingest, smart-response
    │   │   ├── guardrails/       # 5-layer anti-hallucination + crisis
    │   │   ├── rag/              # pgvector + tsvector + RRF
    │   │   ├── voice/            # Retell, Deepgram, ElevenLabs
    │   │   ├── billing/          # Stripe, Conekta
    │   │   ├── intelligence/     # Sentiment, journey, feedback loops
    │   │   ├── observability/    # Sentry + metrics + error tracker
    │   │   ├── eval/             # Golden dataset + runner (12 cases)
    │   │   └── utils/            # token-estimate, crypto, logger
    │   ├── components/           # shadcn/ui + dashboard + onboarding
    │   └── types/                # Shared TypeScript interfaces
    ├── supabase/migrations/      # 25 idempotent SQL migrations
    ├── schema.sql                # Canonical schema (RLS-first)
    ├── sentry.server.config.ts   # Production error tracking
    ├── vercel.json               # 25 cron schedules
    └── vitest.config.ts          # Test runner
```

## Founder

Built by **Javier Cámara** ([@javiercamarapp](https://x.com/javiercamarapp)) — solo technical founder, shipping AI-native companies for LATAM.

Sister project: **[Moni AI](https://monifinancialai.com)** — consumer fintech × applied AI, centralizing accounts and giving AI-powered financial advice to Latin American users.

**Philosophy:**
> *Real products. Frontier AI. LATAM underserved market. Long-term compounding through technology.*
>
> Not demos. Not research projects. Ship fast, learn in public, iterate aggressively.

## License

**Proprietary.** © atiende.ai 2026. All rights reserved. Commercial use requires a signed agreement.

The repo is public so collaborators and early partners can review the system — not as OSS. If you want to build on top, [reach out](https://x.com/javiercamarapp).

## Talk to us

- 🌐 **Product:** [https://useatiende.ai](https://useatiende.ai)
- 📩 **DMs open:** [x.com/javiercamarapp](https://x.com/javiercamarapp)
- 💼 **LinkedIn:** [Javier Cámara Porte Petit](https://www.linkedin.com/in/javier-cámara-porte-petit)

If you're building in the LATAM SMB × agentic-AI space — we're happy to walk through the playbook and GTM in detail.

---

<sub>⚡ Built in public. Shipping daily. Playing long-term. Small team, extreme leverage.</sub>
