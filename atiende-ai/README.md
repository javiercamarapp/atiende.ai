# atiende.ai

AI-powered WhatsApp & voice agents for Mexican SMEs. Deploy a 24/7 customer service bot in minutes — no code required.

## What is atiende.ai?

atiende.ai is a B2B SaaS platform that lets small businesses in Mexico automate customer interactions via WhatsApp and voice calls. Businesses complete a 6-step onboarding wizard, and the platform generates an AI agent with industry-specific knowledge, guardrails, and automations.

**Target market:** 25+ industries (dental, restaurants, real estate, insurance, salons, hotels, schools, veterinary, etc.)

## Architecture

```
Customer WhatsApp Message
    |
[Meta Webhook] --> POST /api/webhook/whatsapp
    |
[HMAC-SHA256 Signature Verify]
    |
[processIncomingMessage] --> src/lib/whatsapp/processor.ts
    |-- Classify intent (GPT-5-nano)     --> src/lib/whatsapp/classifier.ts
    |-- Search RAG for context (pgvector) --> src/lib/whatsapp/rag-context.ts
    |-- Select LLM model (routing)        --> src/lib/llm/openrouter.ts
    |-- Generate response                 --> src/lib/whatsapp/response-builder.ts
    |-- Validate (guardrails)             --> src/lib/guardrails/validate.ts
    |-- Execute action (appointments, orders, leads)
    |-- Send via Meta Cloud API           --> src/lib/whatsapp/send.ts
    +-- Log to DB + track costs
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript 5 |
| UI | shadcn/ui + Tailwind CSS 4 |
| Database | Supabase (PostgreSQL 15 + pgvector + RLS) |
| LLM | OpenRouter (Gemini Flash, Claude Sonnet, GPT-5-nano classifier) |
| Voice | Retell AI + ElevenLabs + Deepgram Nova-3 |
| Messaging | WhatsApp Cloud API v21.0 |
| Payments | Stripe + Conekta (OXXO/SPEI) |
| Calendar | Google Calendar API |
| Cache | Upstash Redis |
| Hosting | Vercel Pro |
| Email | Resend |

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Supabase project (with pgvector extension)
- Vercel account

### Setup

```bash
git clone https://github.com/javiercamarapp/atiende.ai.git
cd atiende.ai/atiende-ai
npm install
cp .env.local.example .env.local  # Fill in your keys
npm run dev
```

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key
OPENROUTER_API_KEY=               # OpenRouter API key
OPENAI_API_KEY=                   # OpenAI (embeddings)
WA_VERIFY_TOKEN=                  # WhatsApp webhook verify token
WA_ACCESS_TOKEN=                  # WhatsApp access token
WA_APP_SECRET=                    # WhatsApp app secret (HMAC)
STRIPE_SECRET_KEY=                # Stripe billing
STRIPE_WEBHOOK_SECRET=            # Stripe webhook signature
CONEKTA_PRIVATE_KEY=              # Conekta (Mexican payments)
CONEKTA_WEBHOOK_KEY=              # Conekta webhook signature
RETELL_API_KEY=                   # Retell AI voice
UPSTASH_REDIS_URL=                # Redis cache/rate-limit
UPSTASH_REDIS_TOKEN=              # Redis auth
RESEND_API_KEY=                   # Email
GOOGLE_MAPS_API_KEY=              # Places search
CRON_SECRET=                      # Cron job auth
```

## Project Structure

```
atiende-ai/
├── src/
│   ├── app/
│   │   ├── (auth)/              # Login, register, onboarding wizard
│   │   ├── (dashboard)/         # Dashboard pages
│   │   └── api/                 # 35 API routes
│   │       ├── webhook/         # WhatsApp, Stripe, Conekta, Retell
│   │       ├── cron/            # 7 scheduled jobs
│   │       ├── billing/         # Checkout, usage, cancel
│   │       ├── calendar/        # Google Calendar
│   │       └── ...
│   ├── lib/
│   │   ├── llm/                 # LLM routing, cost calculation
│   │   ├── whatsapp/            # Message processing pipeline
│   │   ├── guardrails/          # Anti-hallucination, safety
│   │   ├── marketplace/         # 25 autonomous agents
│   │   ├── actions/             # Intent handlers + state machine
│   │   ├── intelligence/        # Sentiment, journey, feedback
│   │   ├── rag/                 # Vector search (pgvector)
│   │   ├── cache.ts             # Tenant config caching (Redis)
│   │   ├── rate-limit.ts        # Per-tenant rate limiting (Redis)
│   │   ├── logger.ts            # Structured JSON logging
│   │   ├── monitoring.ts        # Metrics tracking
│   │   └── pagination.ts        # Query pagination helper
│   ├── components/              # React components
│   └── types/                   # TypeScript interfaces
├── schema.sql                   # PostgreSQL schema (15 tables + RLS)
├── .github/workflows/ci.yml     # CI/CD pipeline
├── vercel.json                  # 7 cron jobs
└── vitest.config.ts             # Test configuration
```

## AI Pipeline

### Intent Classification (18 intents)
GREETING, FAREWELL, FAQ, PRICE, HOURS, LOCATION, APPOINTMENT_NEW/MODIFY/CANCEL, ORDER_NEW/STATUS, COMPLAINT, EMERGENCY, MEDICAL_QUESTION, LEGAL_QUESTION, HUMAN, CRISIS, SERVICES_INFO

### Model Routing
| Condition | Model | Cost |
|-----------|-------|------|
| Classification | GPT-5-nano | $0.05/$0.40 per M tokens |
| Standard (70%) | Gemini 2.5 Flash-Lite | $0.10/$0.40 |
| Balanced (20%) | Gemini 2.5 Flash | $0.30/$2.50 |
| Sensitive (10%) | Claude Sonnet 4.6 | $3.00/$15.00 |

### Guardrails
- **Medical:** Blocks diagnosis, prescriptions, dosages
- **Crisis:** Detects suicide ideation → emergency hotlines
- **Prices:** Validates against RAG context
- **Length:** Max 600 chars per WhatsApp message

## Marketplace Agents (25)

Autonomous cron/event-triggered automations with per-tenant config and pricing ($199-$499 MXN/month).

## Database (15 tables with RLS)

All tables enforce Row-Level Security via `get_user_tenant_id()`.

## Testing

```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
npm run type-check        # TypeScript check
```

## Security

- HMAC-SHA256 webhook verification (WhatsApp, Stripe, Conekta)
- Row-Level Security on all 15 tables
- AES-256-GCM credential encryption
- CSP + HSTS + OWASP headers
- Per-tenant Redis rate limiting
- PII redaction in webhook logs

## License

Proprietary. All rights reserved.
