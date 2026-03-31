# KNOWLEDGE CACHE — atiende.ai
# Este archivo evita re-leer los 25+ documentos originales.
# Fuente de verdad: CLAUDE (5).md — usar lineas 1855-6524 (markdown limpio)

---

## INDICE DE ARCHIVOS POR LINEA EN CLAUDE.md

### FASE 0 (lineas 20-43): Setup
- Comandos: create-next-app, shadcn init, npm install, mkdir

### FASE 1 (lineas 48-1854): Config
- .env.local: lineas 51-91
- SQL Schema: lineas 95-1854 (19 tablas + RLS + funciones)

### FASE 2 (lineas 1855-2519): Core Lib Clients
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/lib/supabase/client.ts | 1857 | 1869 |
| src/lib/supabase/server.ts | 1870 | 1896 |
| src/lib/supabase/admin.ts | 1897 | 1909 |
| src/lib/llm/openrouter.ts | 1910 | 2059 |
| src/lib/llm/classifier.ts | 2060 | 2091 |
| src/lib/rag/search.ts | 2092 | 2180 |
| src/lib/guardrails/validate.ts | 2181 | 2256 |
| src/lib/whatsapp/send.ts | 2257 | 2382 |
| src/lib/voice/deepgram.ts | 2383 | 2435 |
| src/lib/voice/retell.ts | 2436 | 2523 |

### FASE 3 (lineas 2524-3221): WhatsApp Pipeline + Templates
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/lib/whatsapp/processor.ts | 2526 | 2810 |
| src/lib/onboarding/questions.ts | 2811 | 3035 |
| src/lib/templates/chat/index.ts | 3036 | 3168 |
| src/lib/templates/voice/index.ts | 3169 | 3221 |

### FASE 4 (lineas 3222-3665): API Routes + Middleware
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/middleware.ts | 3224 | 3282 |
| src/app/api/webhook/whatsapp/route.ts | 3283 | 3316 |
| src/app/api/webhook/retell/route.ts | 3317 | 3445 |
| src/app/api/onboarding/create-agent/route.ts | 3446 | 3665 |

### FASE 5 (lineas 3666-4443): Onboarding Wizard
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/(auth)/onboarding/layout.tsx | 3668 | 3687 |
| src/app/(auth)/onboarding/step-1/page.tsx | 3688 | 3772 |
| src/app/(auth)/onboarding/step-2/page.tsx | 3773 | 3872 |
| src/app/(auth)/onboarding/step-3/page.tsx | 3873 | 4007 |
| src/app/(auth)/onboarding/step-4/page.tsx | 4008 | 4154 |
| src/app/(auth)/onboarding/step-5/page.tsx | 4155 | 4288 |
| src/app/(auth)/onboarding/step-6/page.tsx | 4289 | 4443 |

### FASE 2b (lineas 4444-4744): Config Adicional
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/globals.css | 4446 | 4483 |
| src/lib/utils.ts | 4484 | 4494 |
| tailwind.config.ts | 4495 | 4512 |
| next.config.ts | 4513 | 4527 |
| vercel.json | 4528 | 4538 |
| src/lib/rate-limit.ts | 4539 | 4565 |
| src/types/index.ts | 4566 | 4606 |
| src/app/layout.tsx | 4607 | 4633 |
| src/lib/analytics/roi.ts | 4634 | 4678 |
| src/lib/billing/stripe.ts | 4679 | 4706 |
| src/lib/billing/conekta.ts | 4707 | 4744 |

### FASE 6 (lineas 4824-5173): Dashboard
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/(dashboard)/layout.tsx | 4826 | 4876 |
| src/components/dashboard/header.tsx | 4877 | 4909 |
| src/components/dashboard/sidebar.tsx | 4910 | 4970 |
| src/components/dashboard/roi-widget.tsx | 4971 | 5021 |
| src/components/dashboard/kpi-cards.tsx | 5022 | 5068 |
| src/components/dashboard/charts.tsx | 5069 | 5099 |
| src/components/dashboard/recent-activity.tsx | 5100 | 5136 |
| src/app/(dashboard)/page.tsx | 5137 | 5173 |

### FASE 7 (lineas 5174-5334): Conversations
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/(dashboard)/conversations/page.tsx | 5176 | 5190 |
| src/components/chat/conversation-list.tsx | 5191 | 5227 |
| src/app/(dashboard)/conversations/[id]/page.tsx | 5228 | 5245 |
| src/components/chat/chat-viewer.tsx | 5246 | 5303 |
| src/app/api/conversations/takeover/route.ts | 5304 | 5316 |
| src/app/api/conversations/send/route.ts | 5317 | 5334 |

### FASE 8 (lineas 5335-5488): Modulos
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/(dashboard)/appointments/page.tsx | 5337 | 5349 |
| src/components/dashboard/appointments-list.tsx | 5350 | 5369 |
| src/app/(dashboard)/orders/page.tsx | 5370 | 5382 |
| src/components/dashboard/orders-list.tsx | 5383 | 5398 |
| src/app/(dashboard)/leads/page.tsx | 5399 | 5411 |
| src/components/dashboard/leads-pipeline.tsx | 5412 | 5430 |
| src/app/(dashboard)/agents/page.tsx | 5431 | 5445 |
| src/components/marketplace/grid.tsx | 5446 | 5472 |
| src/app/api/agents/toggle/route.ts | 5473 | 5488 |

### FASE 9 (lineas 5489-5863): Auth + Landing + Settings + Billing + APIs
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/app/(dashboard)/calls/page.tsx | 5491 | 5508 |
| src/app/(dashboard)/knowledge/page.tsx | 5509 | 5525 |
| src/app/(dashboard)/analytics/page.tsx | 5526 | 5550 |
| src/app/(dashboard)/playground/page.tsx | 5551 | 5575 |
| src/app/(auth)/login/page.tsx | 5576 | 5596 |
| src/app/(auth)/register/page.tsx | 5597 | 5617 |
| src/app/(marketing)/page.tsx | 5618 | 5632 |
| src/app/(dashboard)/settings/agent/page.tsx | 5633 | 5657 |
| src/app/(dashboard)/settings/team/page.tsx | 5658 | 5680 |
| src/app/(dashboard)/settings/services/page.tsx | 5681 | 5705 |
| src/app/(dashboard)/settings/billing/page.tsx | 5706 | 5717 |
| src/components/dashboard/billing-manager.tsx | 5718 | 5737 |
| src/app/api/webhook/stripe/route.ts | 5738 | 5752 |
| src/app/api/webhook/conekta/route.ts | 5753 | 5764 |
| src/app/api/billing/checkout/route.ts | 5765 | 5779 |
| src/app/api/cron/reminders/route.ts | 5780 | 5795 |
| src/app/api/cron/analytics/route.ts | 5796 | 5816 |
| src/app/api/places/search/route.ts | 5817 | 5831 |
| src/app/api/onboarding/test-bot/route.ts | 5832 | 5844 |
| src/app/api/knowledge/reingest-services/route.ts | 5845 | 5863 |

### FASE 10 (lineas 5922-6524): Integraciones
| Archivo | Linea Inicio | Linea Fin |
|---|---|---|
| src/lib/calendar/google.ts | 5934 | 6058 |
| src/app/api/calendar/availability/route.ts | 6059 | 6096 |
| src/app/api/calendar/book/route.ts | 6097 | 6161 |
| src/lib/integrations/softrestaurant.ts | 6218 | 6292 |
| src/lib/integrations/delivery.ts | 6293 | 6338 |
| src/lib/integrations/facturapi.ts | 6339 | 6391 |
| src/lib/integrations/cloudbeds.ts | 6392 | 6445 |
| src/app/api/cron/sync-menu/route.ts | 6482 | 6522 |

### SQL Seed Marketplace (lineas 5864-5888): 15 Agents INSERT
### SQL Seed Dashboard Configs (dentro del schema)

---

## STACK COMPLETO

```
Frontend: Next.js 15 + React 19 + TypeScript
Styling: Tailwind CSS + shadcn/ui
Database: Supabase (PostgreSQL 15 + pgvector + Auth + RLS + Realtime)
LLM: OpenRouter API (proxy a 290+ modelos)
  - Classifier: openai/gpt-5-nano ($0.05/$0.40 per M)
  - Standard (70%): google/gemini-2.5-flash-lite ($0.10/$0.40)
  - Balanced (20%): google/gemini-2.5-flash ($0.30/$2.50)
  - Premium (10%): anthropic/claude-sonnet-4-6 ($3.00/$15.00)
  - Voice: google/gemini-2.5-flash-lite
  - Generator: google/gemini-2.5-flash
Embeddings: OpenAI text-embedding-3-small ($0.02/M tokens, 1536 dims)
Chat: Meta WhatsApp Cloud API v21.0
Voice: Retell AI + ElevenLabs Flash v2.5 + Deepgram Nova-3 + Telnyx
Cache: Upstash Redis (rate limiting, sessions)
Payments: Stripe (cards) + Conekta (OXXO, SPEI)
Hosting: Vercel Pro ($20/mes)
Charts: Recharts
Icons: Lucide React
```

---

## DEPENDENCIAS NPM

```bash
# Core (del CLAUDE.md)
npm install openai @supabase/supabase-js @supabase/ssr axios recharts lucide-react stripe @upstash/redis googleapis

# Extras (de la Guia PDF — prevenir errores en fases posteriores)
npm install zod date-fns
```

## SHADCN COMPONENTS

```bash
# CLAUDE.md original
npx shadcn@latest add button card input label textarea select badge switch tabs dialog sonner

# Extras necesarios (Guia PDF + imports detectados)
npx shadcn@latest add checkbox radio-group popover command calendar skeleton alert form toast separator table dropdown-menu tooltip avatar progress sheet
```

---

## 19 TABLAS DE BASE DE DATOS

1. tenants — negocio principal (user_id, business_type, plan, wa_phone_number_id, prompts, LLM config)
2. staff — doctores, estilistas (schedule JSONB, google_calendar_id)
3. services — servicios con precios y duracion
4. knowledge_chunks — RAG pgvector (embedding VECTOR(1536), HNSW index)
5. contacts — clientes (phone unique per tenant, lead_score, lead_temperature)
6. conversations — hilos chat/voz (status: active, resolved, human_handoff, spam, archived)
7. messages — cada mensaje (intent, model_used, tokens, cost_usd, response_time_ms, confidence)
8. appointments — citas (google_event_id, reminder_24h_sent, reminder_1h_sent)
9. orders — pedidos restaurante (items JSONB, delivery/pickup/dine_in)
10. leads — BANT qualification (budget, authority, need, timeline, score 0-100)
11. voice_calls — llamadas (retell_call_id, transcript, sentiment, outcome)
12. daily_analytics — metricas pre-agregadas (conversations, messages, appointments, revenue, costs)
13. marketplace_agents — 15 agentes pre-construidos
14. tenant_agents — activaciones por tenant
15. onboarding_responses — respuestas del wizard por paso
16. dashboard_configs — KPIs y modulos por business_type
17. audit_log — trail de seguridad

Funciones SQL:
- search_knowledge(tenant_uuid, query_embedding, threshold, match_limit) — busqueda vectorial
- get_user_tenant_id() — extrae tenant del JWT para RLS

---

## LLM ROUTING RULES

```
1. Premium plan → siempre BALANCED (Gemini Flash)
2. Intents sensibles (EMERGENCY, COMPLAINT, HUMAN, CRISIS, MEDICAL_QUESTION, LEGAL_QUESTION) → Claude Sonnet
3. Health businesses (dental, medical, psychologist, etc.) → BALANCED
4. Real estate + credit → BALANCED
5. Veterinary emergency → Claude
6. Appointments/orders/complex → BALANCED
7. Todo lo demas → STANDARD (Gemini Flash-Lite)
```

---

## 20 INTENTS DEL CLASIFICADOR

GREETING, FAREWELL, FAQ, PRICE, HOURS, LOCATION, APPOINTMENT_NEW, APPOINTMENT_MODIFY, APPOINTMENT_CANCEL, ORDER_NEW, ORDER_STATUS, COMPLAINT, EMERGENCY, MEDICAL_QUESTION, LEGAL_QUESTION, HUMAN, CRISIS, SERVICES_INFO, THANK_YOU, OTHER

---

## 25 BUSINESS TYPES

dental, medical, nutritionist, dermatologist, psychologist, gynecologist, pediatrician, ophthalmologist, restaurant, taqueria, cafe, hotel, real_estate, salon, barbershop, spa, gym, veterinary, pharmacy, school, insurance, mechanic, accountant, florist, optics, other

---

## 15 MARKETPLACE AGENTS

1. Cobrador — payment reminders (cron Mon/Wed/Fri 10am) $499
2. Resenas — Google review requests (event: appointment.completed, 24h delay) $299
3. Reactivacion — inactive customer outreach (cron 1st of month) $399
4. Cumpleanos — birthday greetings (cron daily 9am) $199
5. Referidos — referral program (event: review.positive) $299
6. NPS — 3-question survey (event: appointment.completed, 2h delay) $199
7. Reportes — weekly summary email (cron Monday 9am) $299
8. FAQ Builder — knowledge gap detection (cron Sunday midnight) $199
9. Seguimiento — post-service instructions (event: appointment.completed, 4h delay) $299
10. Optimizador — cancellation recovery (event: appointment.cancelled) $399
11. Bilingue — language detection (event: conversation.new) $299
12. Inventario — stock verification (event: order.new) $299
13. Calificador — BANT lead scoring (event: conversation.new) $399
14. Upselling — service recommendations (event: appointment.completed) $299
15. Redes Sociales — social → WhatsApp bridge (event: social.comment) $399

---

## GUARDRAILS POR INDUSTRIA (CRITICOS)

### Dental/Medical/Health:
- NUNCA diagnosticar
- NUNCA recetar medicamentos
- Palabras prohibidas: "diagnostico", "le recomiendo tomar", "probablemente tiene", "mg de"
- Dolor agudo → agendar urgente

### Psicologia:
- MAXIMA sensibilidad
- Crisis → Linea de la Vida: 800 911 2000, SAPTEL: 55 5259 8121
- Keywords: "quiero morirme", "suicidarme", "me corto", "no quiero vivir"

### Restaurante:
- Siempre preguntar alergias
- Tiempos de entrega "aproximadamente" (nunca exactos)

### Inmobiliaria:
- BANT qualification obligatorio
- NUNCA prometer plusvalia ni rendimientos

### Veterinaria:
- Envenenamiento/atropello/convulsiones → "traiga a su mascota YA"

### Todos:
- Nunca inventar precios (validar contra RAG)
- Max 600 caracteres WhatsApp
- Ofrecer siempre: "Si prefiere hablar con una persona, con gusto le comunico"

---

## ROI RATES POR INDUSTRIA (MXN/hora)

dental: $75, medical: $75, psychologist: $80, nutritionist: $60, dermatologist: $75,
restaurant: $50, taqueria: $50, cafe: $55, hotel: $80, real_estate: $100,
salon: $60, barbershop: $55, spa: $65, gym: $55, veterinary: $60,
pharmacy: $55, school: $65, insurance: $90, mechanic: $55, accountant: $90,
florist: $50, optics: $65

---

## PROBLEMAS CONOCIDOS Y FIXES

1. Agregar `checkbox` a shadcn (step-4 lo importa)
2. Conflicto ruta `/` → middleware redirige por auth
3. stripe apiVersion → cast as any
4. HandMetal icon → usar Hand
5. Schedule days (numerico vs espanol) → mapear
6. response.model no tipado → type assertion
7. step-3 /api/places/search no existe hasta fase 9 → OK en build
8. CLAUDE.md lineas 1-1850 tienen wrapper Python → usar 1855+
9. Agregar zod, date-fns a dependencias
