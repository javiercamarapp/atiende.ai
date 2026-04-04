# CLAUDE.md — atiende.ai Conversational Onboarding System
# Version: 2.0 | April 2026
# Purpose: Blueprint for Claude Code to implement the per-vertical onboarding + agent generation

## PROJECT OVERVIEW

atiende.ai is a multi-tenant SaaS platform that sells AI WhatsApp chatbots and voice agents to Mexican SMBs. This CLAUDE.md covers the **conversational onboarding system** — the flow where a new business owner configures their AI agent by answering questions specific to their industry.

**The key insight**: Instead of a generic wizard with dropdowns, we use a conversational interface (chat-style) that asks industry-specific questions, gives ROI insights after each answer, and generates a fully configured AI agent at the end.

**Frontend**: Terminal-retro style, white background, black text, typewriter effect. Reference implementation: `atiende-onboarding-white-v5.jsx` in `/mnt/user-data/outputs/`.

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 15)                  │
│  atiende-onboarding-white-v5.jsx (terminal retro style)  │
│  White bg · Black text · Typewriter · atiende.ai logo    │
│  Channel: [Web Chat] or [WhatsApp]                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              ONBOARDING API (Next.js API Routes)         │
│  POST /api/onboarding/start       → create session       │
│  POST /api/onboarding/answer      → process answer        │
│  GET  /api/onboarding/status/:id  → check progress        │
│  POST /api/onboarding/generate    → generate agent config │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                  │
│                                                          │
│  onboarding_sessions                                     │
│  ├── id (uuid)                                          │
│  ├── business_type (enum: 43 verticals)                 │
│  ├── current_question (int)                             │
│  ├── answers (jsonb)                                    │
│  ├── channel (web | whatsapp)                           │
│  ├── status (in_progress | completed | abandoned)       │
│  ├── created_at, updated_at                             │
│  └── tenant_id (uuid → tenants)                         │
│                                                          │
│  tenants                                                 │
│  ├── id, name, business_type, city, state               │
│  ├── onboarding_answers (jsonb — complete config)       │
│  ├── agent_config (jsonb — generated prompt + rules)    │
│  └── created_at, activated_at                           │
│                                                          │
│  vertical_questions                                      │
│  ├── id, vertical (enum)                                │
│  ├── question_number (int)                              │
│  ├── question_text (text)                               │
│  ├── question_why (text — insight shown to user)        │
│  ├── input_type (text | select | multiselect | price_list) │
│  ├── required (boolean)                                 │
│  ├── validation_rules (jsonb)                           │
│  └── follow_up_insight (text — ROI fact shown after)    │
│                                                          │
│  vertical_metadata                                       │
│  ├── vertical (enum), category                          │
│  ├── software_ecosystem (jsonb)                         │
│  ├── top_faqs (jsonb — array of 10)                     │
│  ├── never_hallucinate (jsonb — array of rules)         │
│  ├── crisis_protocols (jsonb — array)                   │
│  └── system_prompt_template (text)                      │
└─────────────────────────────────────────────────────────┘
```

---

## FASE 0: PROJECT SETUP

**Objetivo**: Scaffold the project and seed the 43-vertical question database.

**Qué pedir al usuario**:
- [ ] "¿Ya tienes el repo de atiende.ai clonado? URL de GitHub?"
- [ ] "Dame las credenciales de Supabase (URL + anon key + service role key)"
- [ ] "Dame la API key de OpenRouter"

**Archivos a crear**:
- `src/lib/verticals/index.ts` — Master registry of all 43 verticals
- `src/lib/verticals/questions/` — One file per vertical with all questions
- `supabase/migrations/001_onboarding_schema.sql` — Database tables
- `supabase/seed/verticals.sql` — Seed all 43 verticals with questions, FAQs, rules

**Datos de referencia**: Usar el PDF `atiende_guia_definitiva_40_verticales.pdf` como fuente maestra. Contiene:
- 43 verticales
- 743 preguntas de onboarding numeradas
- Software con precios MXN por vertical
- Top 10 FAQs por vertical
- Reglas anti-alucinación por vertical
- Protocolos de crisis por vertical

**Checkpoint**:
- [ ] `SELECT count(*) FROM vertical_questions;` returns 743
- [ ] `SELECT count(DISTINCT vertical) FROM vertical_questions;` returns 43
- [ ] All vertical metadata (FAQs, rules, protocols) seeded

---

## FASE 1: VERTICAL DETECTION ENGINE

**Objetivo**: Detect business type from natural language input.

When the user says "Soy dentista" or "Tengo una taquería" or "Mi negocio es un hotel boutique en Tulum", the system must map this to one of the 43 verticals.

**Archivos a crear**:
- `src/lib/onboarding/detect-vertical.ts`

**Lógica**:
```typescript
// Map natural language → vertical enum
// Use LLM (Gemini 2.5 Flash-Lite via OpenRouter) with this prompt:

const DETECTION_PROMPT = `
Eres el sistema de clasificación de atiende.ai.
El usuario describió su negocio. Clasifícalo en UNA de estas 43 categorías:

SALUD: dental, medico, nutriologa, psicologo, dermatologo, ginecologo, pediatra, oftalmologo, farmacia, veterinaria
GASTRONOMIA: restaurante, taqueria, cafeteria, panaderia, bar_cantina, food_truck
HOSPEDAJE: hotel, hotel_boutique, motel, glamping, bb_hostal, resort
BELLEZA: salon_belleza, barberia, spa, gimnasio, nail_salon, estetica
RETAIL: floreria, tienda_ropa, papeleria, ferreteria, abarrotes, libreria, joyeria, jugueteria, zapateria
SERVICIOS: contable_legal, seguros, taller_mecanico, escuela, agencia_digital, fotografo

Responde SOLO con el enum. Si no puedes clasificar, responde "unknown".

Negocio del usuario: "{user_input}"
`;
```

**After detection, show insight**:
```
"¡Genial! Un consultorio dental en Mérida 🦷
¿Sabías que el 67% de las citas dentales se agendan fuera de horario laboral? 
Con tu agente AI, vas a capturar esas citas 24/7.
Vamos a configurar tu agente. Te haré algunas preguntas..."
```

**Checkpoint**:
- [ ] "Soy dentista" → `dental`
- [ ] "Tengo un restaurante de mariscos" → `restaurante`
- [ ] "Mi negocio es un glamping en Oaxaca" → `glamping`
- [ ] "Vendo seguros" → `seguros`

---

## FASE 2: CONVERSATIONAL QUESTION ENGINE

**Objetivo**: Ask questions one by one, show insights, store answers.

**Archivos a crear**:
- `src/lib/onboarding/question-engine.ts`
- `src/lib/onboarding/insights.ts`
- `src/lib/onboarding/answer-processor.ts`

**Flow per question**:
```
1. Get next question for this vertical + question_number
2. Format question naturally (use client's name if known)
3. Send to frontend (typewriter effect)
4. Receive answer
5. Validate answer (type-specific)
6. Store in onboarding_sessions.answers[question_key]
7. Show follow-up insight (ROI fact, industry stat)
8. Advance to next question
```

**Natural formatting rules**:
- After question #1 (business name), use it in all subsequent questions:
  "Perfecto, [Consultorio Dental Sonrisas]! Ahora dime..."
- After question #3 (hours), give insight:
  "Excelente. Con horario de L-V 9-19, el chatbot capturará las consultas de las 19:01 en adelante — que es cuando la gente busca dentista después del trabajo."
- Group related questions logically (don't ask hours then prices then hours again)
- Use the `question_why` field to show context when the user asks "¿para qué necesitas eso?"

**Per-vertical question count**:
| Vertical | Questions |
|----------|-----------|
| Dental | 28 |
| Medico | 22 |
| Nutriologa | 19 |
| Psicologo | 20 |
| Dermatologo | 17 |
| Ginecologo | 20 |
| Pediatra | 17 |
| Oftalmologo | 16 |
| Farmacia | 13 |
| Veterinaria | 20 |
| Restaurante | 22 |
| Taqueria | 15 |
| Cafeteria | 17 |
| Panaderia | 15 |
| Bar/Cantina | 18 |
| Food Truck | 12 |
| Hotel | 22 |
| Hotel Boutique | 17 |
| Motel | 13 |
| Glamping | 21 |
| B&B/Hostal | 20 |
| Resort | 21 |
| Salon Belleza | 16 |
| Barberia | 15 |
| Spa | 15 |
| Gimnasio | 19 |
| Nail Salon | 15 |
| Estetica | 16 |
| Floreria | 16 |
| Tienda Ropa | 17 |
| Papeleria | 12 |
| Ferreteria | 13 |
| Abarrotes | 12 |
| Libreria | 15 |
| Joyeria | 16 |
| Jugueteria | 16 |
| Zapateria | 16 |
| Contable/Legal | 17 |
| Seguros | 16 |
| Taller Mecanico | 19 |
| Escuela | 21 |
| Agencia Digital | 15 |
| Fotografo | 21 |

**Checkpoint**:
- [ ] Complete onboarding for dental (28 questions) stores all answers in JSONB
- [ ] Insights display after key questions (prices, hours, services)
- [ ] Progress indicator shows X/28 (or X/N for each vertical)
- [ ] Skip/come-back-later functionality works

---

## FASE 3: AI AGENT GENERATION

**Objetivo**: Transform onboarding answers into a fully configured AI agent.

**Archivos a crear**:
- `src/lib/onboarding/generate-agent.ts`
- `src/lib/agents/system-prompt-builder.ts`
- `src/lib/agents/rag-knowledge-builder.ts`

**Process**:
```
1. Collect all answers from onboarding_sessions
2. Load vertical_metadata (FAQs, never_hallucinate, crisis_protocols)
3. Build system prompt using template + answers
4. Build RAG knowledge base from answers
5. Store in tenants.agent_config
6. Activate tenant
```

**System Prompt Template (per vertical)**:
```
Eres el asistente virtual de {business_name}, {vertical_description} ubicado en {address}, {city}.

Tu tono es {tone}. {formal_informal_instructions}

INFORMACIÓN VERIFICADA (ÚNICA fuente de verdad):
- Horario: {hours}
- Servicios y precios: {services_json}
- Formas de pago: {payment_methods}
- {vertical_specific_fields}

REGLAS ABSOLUTAS:
1. SI NO TIENES EL DATO EXACTO EN TU CONTEXTO, DI "Permítame verificar esa información con el equipo de {business_name}. Te respondo en un momento."
2. NUNCA inventes precios, horarios, disponibilidad, ingredientes, ni diagnósticos.
3. {vertical_specific_never_hallucinate_rules}

PROTOCOLOS DE CRISIS:
{crisis_protocols}

PREGUNTAS FRECUENTES (responde directamente):
{top_faqs_with_answers}

ESCALACIÓN A HUMANO:
- Cuando el cliente pida hablar con una persona
- Quejas no resueltas en 2 intentos
- Emergencias médicas/legales
- Cotizaciones complejas que requieren valoración
- Contacto de escalación: {escalation_contact}
```

**Checkpoint**:
- [ ] Generated system prompt for a dental clinic is >500 tokens
- [ ] Prompt includes all answers from onboarding
- [ ] Never-hallucinate rules are embedded
- [ ] Crisis protocols are embedded
- [ ] RAG knowledge chunks created from service lists, hours, prices

---

## FASE 4: FRONTEND — TERMINAL RETRO ONBOARDING

**Objetivo**: Implement the conversational UI from the approved v5 prototype.

**Reference**: `/mnt/user-data/outputs/atiende-onboarding-white-v5.jsx`

**Design specs (approved by Javier)**:
- White background (#ffffff)
- Black text (#000000)
- Black buttons
- atiende.ai logo at top
- First screen: TWO buttons only (Web / WhatsApp) — NO input bar
- After "Web" selected: input bar slides up with animation
- Input bar: 3/4 width, no $ symbol, camera + file attach buttons
- Black glow on focus (not green — fits white theme)
- Footer with version number, darkened for readability
- Typewriter effect on ALL AI messages
- Business type detection from natural language
- Per-vertical ROI insights after business type identification

**Archivos a crear**:
- `src/app/onboarding/page.tsx` — Main onboarding page
- `src/components/onboarding/OnboardingChat.tsx` — Chat container
- `src/components/onboarding/TypewriterMessage.tsx` — Typewriter effect
- `src/components/onboarding/ChannelSelector.tsx` — Web/WhatsApp buttons
- `src/components/onboarding/ChatInput.tsx` — Input bar with camera/file
- `src/components/onboarding/ProgressIndicator.tsx` — Question progress
- `src/components/onboarding/InsightCard.tsx` — ROI insight display
- `src/components/onboarding/GenerationAnimation.tsx` — Agent creation animation

**Flow**:
```
[Logo + "Bienvenido a atiende.ai"]
[Botón: Web] [Botón: WhatsApp]
    ↓ user clicks "Web"
[Input bar slides up]
"Cuéntame sobre tu negocio..."
    ↓ user: "Soy dentista en Mérida"
[Typewriter]: "¡Genial! Un consultorio dental en Mérida 🦷
El 67% de citas dentales se agendan fuera de horario.
Vamos a configurar tu agente. Son [28] preguntas rápidas."
    ↓
"Pregunta 1/28: ¿Cuál es el nombre completo de tu consultorio?"
    ↓ user: "Consultorio Dental Sonrisas"
[Typewriter]: "Perfecto, Consultorio Dental Sonrisas.
Pregunta 2/28: ¿Cuál es la dirección completa?"
    ...
[After all questions]:
[Generation Animation — 5-10 seconds]
"🎉 ¡Tu agente está listo!
Nombre: Asistente de Consultorio Dental Sonrisas
Puede responder sobre: 8 servicios, horarios, precios, facturación
Canales: WhatsApp + Web Chat
[Activar Agente] [Editar Respuestas] [Vista Previa]"
```

**Checkpoint**:
- [ ] Logo renders correctly from `/mnt/user-data/outputs/atiende-logo.png`
- [ ] Channel selector shows before input bar
- [ ] Typewriter effect works on all AI messages
- [ ] Progress indicator shows current/total questions per vertical
- [ ] Generation animation plays at end
- [ ] Mobile responsive (primary target)

---

## FASE 5: WHATSAPP ONBOARDING CHANNEL

**Objetivo**: Same question flow but via WhatsApp Business API.

**Archivos a crear**:
- `src/lib/whatsapp/onboarding-handler.ts`
- `src/app/api/webhooks/whatsapp/route.ts`

**Key differences from web**:
- No typewriter effect (WhatsApp delivers messages instantly)
- Use WhatsApp interactive messages (buttons, lists) where possible
- Store session by phone number
- Rate limit: don't send more than 3 messages in a row without user response
- Use typing indicators between messages
- Respect 24-hour window — if user returns after 24h, send template to resume

**Checkpoint**:
- [ ] WhatsApp webhook receives messages
- [ ] Session persists across messages by phone number
- [ ] Questions flow naturally one at a time
- [ ] Onboarding completes via WhatsApp and generates same agent config

---

## FASE 6: AGENT DEPLOYMENT + TESTING

**Objetivo**: Deploy generated agents and test them.

**Archivos a crear**:
- `src/lib/agents/whatsapp-agent.ts` — WhatsApp message handler using agent_config
- `src/lib/agents/web-agent.ts` — Web widget handler
- `src/app/api/agents/[tenantId]/chat/route.ts` — Agent chat endpoint
- `src/app/api/webhooks/whatsapp/[tenantId]/route.ts` — Per-tenant WhatsApp webhook

**Agent architecture**:
```
Incoming message (WhatsApp or web)
    → Load tenant agent_config from Supabase
    → Build context (system prompt + RAG chunks + conversation history)
    → Send to Gemini 2.5 Flash-Lite via OpenRouter
    → Post-process: check for hallucination markers ($ without context, times without context)
    → If hallucination detected: replace with fallback phrase
    → Send response to user
```

**Testing protocol per vertical**:
1. Complete onboarding as test business
2. Ask all 10 top FAQs — verify answers match onboarding data
3. Ask questions NOT in knowledge base — verify fallback response triggers
4. Test crisis scenarios — verify escalation triggers
5. Test in Spanish with Mexican colloquialisms
6. Test edge cases: emojis, voice notes (transcribe first), images

**Checkpoint**:
- [ ] Agent responds correctly to top 10 FAQs for dental vertical
- [ ] Agent says "permítame verificar" for unknown questions
- [ ] Agent escalates on crisis keywords (emergencia, dolor severo, demanda)
- [ ] Response time < 3 seconds
- [ ] Works on WhatsApp and web widget

---

## FASE 7: DEPLOY TO PRODUCTION

**Objetivo**: Deploy to Vercel + configure production WhatsApp.

**Qué pedir al usuario**:
- [ ] "Dame el Vercel project ID o crea uno nuevo"
- [ ] "Dame el Meta WhatsApp Business API token"
- [ ] "Dame el número de WhatsApp Business verificado"
- [ ] "Dame las credenciales de Stripe/Conekta para billing"

**Deploy steps**:
```bash
# 1. Set environment variables in Vercel
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add OPENROUTER_API_KEY
vercel env add WHATSAPP_VERIFY_TOKEN
vercel env add WHATSAPP_ACCESS_TOKEN
vercel env add WHATSAPP_PHONE_NUMBER_ID

# 2. Deploy
vercel --prod

# 3. Configure WhatsApp webhook
# URL: https://atiende-ai.vercel.app/api/webhooks/whatsapp
# Verify token: [configured above]

# 4. Test with real WhatsApp message
```

**Checkpoint**:
- [ ] `curl https://atiende-ai.vercel.app/api/health` returns `{"status":"ok"}`
- [ ] WhatsApp webhook verified by Meta
- [ ] First real onboarding completed end-to-end
- [ ] First real client's agent responds to test message on WhatsApp

---

## STACK REFERENCE

| Layer | Tool | Config |
|-------|------|--------|
| Frontend | Next.js 15 + Tailwind | App router, RSC |
| Database | Supabase PostgreSQL | pgvector for RAG |
| Auth | Supabase Auth | Magic link + phone |
| LLM | OpenRouter → Gemini 2.5 Flash-Lite | Primary (75% cheaper than GPT-4.1-mini) |
| LLM classifier | OpenRouter → GPT-5-nano | Vertical detection only |
| Embeddings | OpenAI text-embedding-3-small | RAG knowledge base |
| Cache | Upstash Redis | Session + rate limiting |
| WhatsApp | Meta Cloud API | Direct, no BSP |
| Voice (Phase 2) | Retell AI + ElevenLabs + Telnyx | Not in this phase |
| Payments | Stripe + Conekta | MXN, OXXO, MSI |
| Deploy | Vercel + GitHub | Auto-deploy on push |
| Invoicing | Facturapi | CFDI 4.0 |

---

## ANTI-HALLUCINATION FRAMEWORK (UNIVERSAL)

Every generated agent MUST include these 3 layers:

### Layer 1: RAG Context Injection
Before generating any response, retrieve top 5 most relevant chunks from the tenant's knowledge base (built from onboarding answers).

### Layer 2: Guardrail System Prompt
```
REGLA ABSOLUTAMENTE INQUEBRANTABLE:
SI NO TIENES EL DATO EXACTO EN TU CONTEXTO, DI:
"Permítame verificar esa información con el equipo de {business_name}. Te respondo en un momento."

NUNCA inventes:
- Precios
- Horarios
- Disponibilidad de citas/productos/servicios
- Ingredientes o alérgenos
- Diagnósticos médicos
- Cobertura de seguros
- Términos de garantía
- Resultados de tratamientos
```

### Layer 3: Post-Generation Validation
Scan response for:
- `$` followed by numbers not present in RAG context → BLOCK
- Time patterns (XX:XX) not in RAG context → BLOCK
- Medical terms + definitive language → BLOCK
- If blocked, replace with fallback phrase

---

## DATA SOURCE

All 43 verticals with 743 total questions are documented in:
- **PDF**: `atiende_guia_definitiva_40_verticales.pdf` (132 pages)
- **Research artifacts**: 4 phases of deep research covering software, APIs, pricing, FAQs, anti-hallucination rules, and crisis protocols per vertical

Categories covered:
1. **Salud y Bienestar** (10): Dental, Médico, Nutrióloga, Psicólogo, Dermatólogo, Ginecólogo, Pediatra, Oftalmólogo, Farmacia, Veterinaria
2. **Gastronomía** (6): Restaurante, Taquería, Cafetería, Panadería, Bar/Cantina, Food Truck
3. **Hospedaje y Turismo** (6): Hotel, Hotel Boutique, Motel, Glamping, B&B/Hostal, Resort
4. **Belleza y Lifestyle** (6): Salón de Belleza, Barbería, Spa, Gimnasio, Nail Salon, Estética
5. **Comercios y Retail** (9): Florería, Tienda de Ropa, Papelería, Ferretería, Abarrotes, Librería, Joyería, Juguetería, Zapatería
6. **Servicios Profesionales** (6): Contable/Legal, Seguros, Taller Mecánico, Escuela, Agencia Digital, Fotógrafo
