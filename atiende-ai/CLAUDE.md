# CLAUDE.md - atiende.ai Development Guide

## Build & Run Commands

```bash
npm run dev           # Start dev server (Next.js 15)
npm run build         # Production build
npm run test          # Run all tests (vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (v8)
npm run type-check    # TypeScript strict check
npm run lint          # ESLint
```

## Project Overview

Multi-tenant WhatsApp AI agent SaaS for Mexican SMEs. Businesses get a 24/7 chatbot with RAG, guardrails, and autonomous marketplace agents.

## Architecture Decisions

- **Multi-tenant via RLS:** All data isolated by `tenant_id` at PostgreSQL level using `get_user_tenant_id()` function
- **LLM routing:** Intent-based model selection (cheap for standard, expensive for sensitive/medical/crisis)
- **Async webhooks:** WhatsApp handler returns 200 immediately, processes message in background
- **Marketplace agents:** Autonomous cron/event-triggered automations with per-tenant config
- **RAG anti-hallucination:** pgvector similarity search + 3-layer guardrail validation

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/whatsapp/processor.ts` | Main message processing orchestrator | 1364 |
| `src/lib/whatsapp/classifier.ts` | Intent classification (18 intents) | 40 |
| `src/lib/whatsapp/rag-context.ts` | RAG context building (pgvector search) | 31 |
| `src/lib/whatsapp/response-builder.ts` | LLM response generation + validation | 113 |
| `src/lib/llm/openrouter.ts` | Multi-model routing + cost calculation | 727 |
| `src/lib/guardrails/validate.ts` | Crisis detection, medical safety, price validation | 239 |
| `src/lib/actions/engine.ts` | 21 intent action handlers | 1065 |
| `src/lib/actions/state-machine.ts` | Conversation state management | 69 |
| `src/lib/marketplace/engine.ts` | Marketplace agent executor (parallel) | 210 |
| `src/lib/marketplace/versioning.ts` | Agent versioning + rollback | 396 |
| `src/lib/intelligence/feedback-loop.ts` | Intent classification accuracy tracking | 391 |
| `src/lib/intelligence/conversation-memory.ts` | Multi-turn conversation context | 340 |
| `src/lib/cache.ts` | Tenant config caching (Redis, 1hr TTL) | 106 |
| `src/lib/rate-limit.ts` | Per-tenant rate limiting (Redis) | 123 |
| `src/lib/logger.ts` | Structured JSON logging | 111 |
| `src/lib/monitoring.ts` | Metrics tracking (LLM, webhooks, agents) | 185 |
| `src/lib/pagination.ts` | Query pagination helper | 42 |
| `src/lib/webhook-logger.ts` | Webhook logging with PII redaction | 149 |
| `src/middleware.ts` | Auth + OWASP security headers + CSP + HSTS | 113 |
| `schema.sql` | Full PostgreSQL schema (RLS + RPCs + triggers) | 593 |

## Code Conventions

- **TypeScript strict mode** — `strict: true` in tsconfig.json
- **Zod validation** — All API inputs validated with Zod schemas
- **Async/await** — No callbacks, no .then() chains
- **Error handling** — Try/catch with structured logging via `logger`
- **Naming** — camelCase for variables/functions, PascalCase for components/types
- **UI text** — Spanish (Mexico). Code/variables — English
- **No `any`** — Use proper types. Escape hatch only with justification comment

## Testing Strategy

Tests use Vitest with jsdom environment. Mock external services (Supabase, OpenRouter, WhatsApp API) with `vi.mock()`.

### Test locations
```
src/app/api/webhook/__tests__/     # Webhook signature verification (4 files)
src/lib/marketplace/__tests__/     # Agent execution tests
src/lib/llm/__tests__/             # Model selection + cost tests
src/lib/intelligence/__tests__/    # Sentiment, journey, response-time
src/lib/guardrails/__tests__/      # Crisis, medical, price validation
src/lib/actions/__tests__/         # State machine, intent engine
src/lib/whatsapp/__tests__/        # Processor pipeline
src/lib/export/__tests__/          # CSV export
src/lib/onboarding/__tests__/      # Onboarding questions
src/lib/analytics/__tests__/       # ROI calculation
```

## Common Tasks

### Adding a new marketplace agent
1. Add agent definition in `src/lib/marketplace/agents/` (pick category: marketing, operations, sales, analytics)
2. Register in the agent registry with slug, trigger type (cron/event), price, prompt template
3. Add test in `src/lib/marketplace/__tests__/`
4. Create version via `createAgentVersion()` in `src/lib/marketplace/versioning.ts`

### Adding a new API route
1. Create `src/app/api/{path}/route.ts`
2. Add auth check: `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()`
3. Validate input with Zod schema
4. Use `logger.info()` / `logger.error()` for structured logging
5. Add test in `__tests__/` directory

### Adding a new intent
1. Add to intent enum in `src/lib/whatsapp/classifier.ts`
2. Add handler in `src/lib/actions/engine.ts`
3. Update model routing rules in `src/lib/llm/openrouter.ts` if needed
4. Add guardrail rules in `src/lib/guardrails/validate.ts` if sensitive
5. Add tests

### Modifying guardrails
1. Edit `src/lib/guardrails/validate.ts`
2. Add forbidden words/patterns for the industry
3. Add test cases in `src/lib/guardrails/__tests__/validate.test.ts`
4. Test with playground before deploying

## Environment Variables

See README.md for full list. Critical ones:
- `SUPABASE_SERVICE_ROLE_KEY` — Server-only, never expose to frontend
- `WA_APP_SECRET` — Used for HMAC-SHA256 webhook verification
- `STRIPE_WEBHOOK_SECRET` — Stripe signature verification
- `CRON_SECRET` — Protects cron endpoints from unauthorized access

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`):
1. Install dependencies
2. Lint (ESLint)
3. Type check (tsc --noEmit)
4. Test (vitest run)
5. Build (next build)

Triggers on push to main and pull requests.
