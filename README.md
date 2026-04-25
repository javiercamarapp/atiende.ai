<h1 align="center">atiende.ai</h1>

<h3 align="center">
La plataforma de operaciones autónomas por WhatsApp para los <strong>4 millones</strong> de PyMEs de servicios de LATAM.
</h3>

<p align="center">
No es un chatbot. Es un agente de IA que <strong>opera el negocio</strong>: agenda, confirma, cobra, reactiva clientes y escala emergencias — 24/7, en español de México, anclado al conocimiento de cada negocio.
</p>

<p align="center">
  <a href="https://useatiende.ai"><img src="https://img.shields.io/badge/🌐_Live-useatiende.ai-000?style=for-the-badge" /></a>
  <img src="https://img.shields.io/badge/Mercado-MX_%2B_LATAM-3ECF8E?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Verticales_activas-15-3178C6?style=for-the-badge" />
</p>

<p align="center">
  <a href="#el-problema">Problema</a> •
  <a href="#la-solución">Solución</a> •
  <a href="#por-qué-ahora">Why now</a> •
  <a href="#cómo-funciona">Cómo funciona</a> •
  <a href="#producto">Producto</a> •
  <a href="#por-qué-ganamos">Moat</a> •
  <a href="#tracción">Tracción</a> •
  <a href="#fundador">Fundador</a>
</p>

---

## El problema

> Las PyMEs mexicanas de servicios pierden ~30% de su revenue potencial porque no contestan el teléfono a las 11pm.

- **67%** de las solicitudes de cita médico/dental llegan **fuera de horario**.
- Una recepcionista 24/7 cuesta **$6,000–$10,000 MXN/mes** — fuera del alcance del 90% de los consultorios single-location.
- El no-show promedio en clínicas LATAM es **25–35%**. Cada slot perdido = $500–$3,000 MXN.
- Los bots actuales (Manychat, Tidio) son árboles de decisión: no agendan, no cobran, no confirman. Frustran al paciente y lo empujan a llamar — donde nadie contesta.

**4M+ PyMEs en México operan su negocio entero por WhatsApp.** Su infraestructura es un grupo de WhatsApp y la memoria de la recepcionista.

> El mercado direccionable: ~4M comercios × ticket SaaS promedio $1,000–$3,500 MXN/mes = **TAM México ≈ $5–14B MXN/año** (sólo MX, sólo verticales actuales).

## La solución

**atiende.ai** despliega un agente de IA en el WhatsApp del negocio en menos de **10 minutos**. El agente reemplaza las funciones operativas de una recepcionista humana — sin la nómina y sin las 8 horas de descanso.

| El agente hace... | Qué reemplaza |
|---|---|
| 📅 **Agenda citas** en el calendario del negocio | Recepcionista que toma llamadas |
| ✅ **Confirma visitas** el día anterior | Asistente que llama uno por uno |
| 💰 **Cobra** vía OXXO / SPEI / tarjeta | Cajera + envío manual de links |
| 🔁 **Reactiva clientes dormidos** con outreach personalizado | Marketing por WhatsApp manual |
| 🚨 **Escala emergencias** a humanos con guardrails médicos | Triage en recepción |
| 🎙️ **Atiende llamadas de voz** (premium) | Receptionist phone line |
| 🧠 **Aprende el negocio** vía wizard que scrapea web + extrae FAQs | 2 semanas de entrenamiento |

Construido para **15 verticales activas**: dental, médico general, psicología, veterinaria, dermatología, ginecología, pediatría, oftalmología, nutrición, salón, barbería, spa, gym, manicure, beauty.

## Por qué ahora

| Enabler | Año | Lo que cambió |
|---|---|---|
| **WhatsApp Cloud API** | 2024 | Pricing y SLAs estables → habilitó SaaS multi-tenant sobre WA |
| **Colapso de costo LLM** | 2023–2026 | Grok 4.1 Fast a $0.20/$1.50 por M tokens → margen bruto positivo en plan $999 MXN |
| **Madurez de tool-calling** | 2024+ | Los modelos ejecutan acciones (book, charge, confirm) confiablemente — ya no es research, es producto |
| **Penetración LATAM de WhatsApp** | 95%+ | vs 30% email. Las PyMEs son **WhatsApp-first** — no hay canal alternativo |

Los 4 enablers convergieron simultáneamente. La ventana se abrió en 2024 y se va a cerrar cuando las grandes plataformas (Meta, Google) integren esto como feature nativo. El terreno es de quien construya el moat de datos, integraciones y vertical knowledge en los próximos 24 meses.

## Cómo funciona

### Flujo paciente → WhatsApp → software → Google Calendar

El **software es la fuente de verdad**. Google Calendar es downstream: se sincroniza después de que el INSERT/UPDATE en la base de datos fue exitoso. Esto garantiza consistencia: nunca existe una cita en Calendar sin row en BD.

```
Paciente
   ↓ "Quiero agendar el jueves a las 10"
WhatsApp Cloud API
   ↓
Webhook firmado (HMAC-SHA256)        ← responde 200 en <100ms
   ↓
Async worker queue
   ↓
Orchestrator de IA                   ← Grok 4.1 Fast → GPT-4.1 mini fallback
   ↓ tool: book_appointment(args)
┌─────────────────────────────────────────────┐
│ 1️⃣  SOFTWARE (Postgres) — fuente de verdad   │
│     INSERT INTO appointments ...             │
│     UNIQUE constraint anti-doble-booking     │
└─────────────────────────────────────────────┘
   ↓ sólo si INSERT OK
┌─────────────────────────────────────────────┐
│ 2️⃣  GOOGLE CALENDAR — sync downstream         │
│     evento creado en el calendar del doctor  │
└─────────────────────────────────────────────┘
   ↓
Respuesta al paciente por WhatsApp
("Listo, quedó tu cita el jueves a las 10:00 con el Dr. X")
```

**Modificar / cancelar siguen el mismo orden**: la BD primero, Google Calendar después. El doctor ve los cambios sincronizados en su calendario en tiempo real.

## Producto

### Capacidades del agente

- **Multi-modal**: texto, audio (transcripción Deepgram Nova-3), imágenes (lectura de recetas, comprobantes)
- **Multi-modelo**: ruteo por intent — el modelo barato responde precios, el modelo médico responde síntomas
- **Conocimiento por tenant**: cada negocio tiene su KB (servicios, precios, horarios, doctores, FAQs) construida automáticamente desde su sitio web
- **RAG híbrido**: búsqueda semántica + lexical + reranking → respuestas ancladas a datos reales del negocio (sin alucinaciones de precios)
- **Guardrails médicos**: detecta crisis (suicida, dolor de pecho, anafilaxia) y escala a humanos con líneas 075/911 incluidas
- **Idempotente**: 3 capas de defensa contra reintentos de Meta — nunca dobla una cita ni cobra dos veces
- **Stateful**: contexto del paciente (citas próximas, plan de tratamiento, guardian, alergias) sobrevive turnos largos sin perderse

### Marketplace de agentes autónomos

Encima del agente conversacional, atiende.ai ejecuta **agentes autónomos** que trabajan por cron o por evento, sin intervención del usuario:

- **Cobrador** — barre citas completadas no pagadas y manda recordatorios
- **No-show recovery** — detecta patrones de incumplimiento y reactiva
- **Smart-followup** — agenda re-visitas según el plan de tratamiento
- **Retención** — identifica clientes en riesgo de churn y manda outreach
- **Pharmacovigilance** — registra eventos adversos según NOM-220-SSA1-2016
- **Doctor-profile** — actualiza la disponibilidad de cada staff
- **Agenda-gap** — detecta huecos y llena con clientes en lista de espera

Cada uno se activa con un click desde el dashboard del owner.

### Voz (premium)

Para consultorios que quieren cubrir el canal telefónico también:

- Llamadas entrantes/salientes con voz natural (ElevenLabs)
- Transcripción en vivo (Deepgram Nova-3)
- Mismo agente, misma KB, mismas tools — sólo cambia el canal
- Billing metered: 300 minutos incluidos + overage

## Por qué ganamos

### El moat es la integración + el dato + el vertical knowledge

| Capa | Por qué es defensible |
|---|---|
| **WhatsApp Business API** | Onboarding requiere verificación Meta. Cada negocio invierte 1–2 días en setup. Switching cost real. |
| **Google Calendar OAuth** | Conexión con refresh tokens cifrados — el doctor concede acceso una vez, queda enlazado. |
| **Conversaciones históricas** | Cada conversación entrena el modelo del tenant: cómo habla la clínica, qué preguntas repite, cómo cierra ventas. |
| **Vertical knowledge** | 15 verticales × guardrails específicos × prompts afinados. Un nuevo entrante construye esto en 18 meses. |
| **Marketplace de agentes** | Cada agente nuevo se vende como upgrade. El tenant que activa 5 agentes no se va. |

### No competimos contra chatbots

Los chatbots de WhatsApp son **decision trees**. Atiende.ai es un **operating system** para el negocio. La diferencia se mide en outcomes, no en mensajes:

- Reducción de no-show (~60%)
- Recovery de revenue de horas non-business (~30%)
- Margin: el agente cuesta 1/30 de lo que cuesta una recepcionista

## Tracción

- **Live en producción**: [useatiende.ai](https://useatiende.ai)
- **15 verticales validadas** con product-market-fit
- **Tickets recurrentes** desde $999 MXN/mes (chat) hasta $4,999 MXN/mes (chat + voz + agentes)
- **Onboarding < 10 min**: ingresa el sitio web, conecta WA, conecta Google Calendar, listo
- **Cobertura geográfica**: México (núcleo) — arquitectura lista para expansión LATAM (Colombia, Argentina, Chile, Perú)

## Arquitectura

```
              ┌──────────────────────────────────┐
              │            Paciente               │
              └──────────────────────────────────┘
                            ↓
              ┌──────────────────────────────────┐
              │   Meta WhatsApp Cloud API         │
              └──────────────────────────────────┘
                            ↓
        ┌────────────────────────────────────────────┐
        │  Webhook firmado → queue async             │
        │  Worker procesa con orchestrator de IA     │
        │  ─ Multi-modelo (Grok / GPT / Claude)      │
        │  ─ RAG híbrido (vector + lexical)          │
        │  ─ Guardrails 5 capas                      │
        │  ─ 19 agentes registrados                  │
        │  ─ 74 tool handlers                        │
        └────────────────────────────────────────────┘
                            ↓
              ┌──────────────────────────────────┐
              │  Postgres (fuente de verdad)      │
              │  + Google Calendar sync           │
              │  + Stripe billing                 │
              │  + Voz (Retell + ElevenLabs)      │
              └──────────────────────────────────┘
```

### Stack

**Frontend**: Next.js 16 (App Router) · React 19 · shadcn/ui · Tailwind 4 · TypeScript strict
**Backend**: Supabase (Postgres 15 + pgvector + RLS) · Upstash Redis + QStash · Vercel Edge
**IA**: OpenRouter multi-model (Grok 4.1 Fast · GPT-4.1 mini · Claude Sonnet 4.6 · Gemini 2.5 Flash · DeepSeek V3.2) · OpenAI embeddings
**Voz**: Retell · ElevenLabs · Deepgram Nova-3 · Telnyx PSTN
**Pagos**: Stripe (incluye OXXO/SPEI vía Mexican rails)
**Observabilidad**: Sentry · structured metrics · per-tenant cost tracking

## Fundador

**Javier Cámara** — fundador técnico solo. Background en construir productos AI-native para LATAM.

Sister project: **[Moni AI](https://monifinancialai.com)** — fintech consumer × AI aplicada, centralizando cuentas y dando consejos financieros con IA a usuarios latinoamericanos.

**Tesis:**
> *Productos reales. AI de frontera. Mercado LATAM desatendido. Compounding a largo plazo via tecnología.*

[@javiercamarapp](https://x.com/javiercamarapp) · [LinkedIn](https://www.linkedin.com/in/javier-cámara-porte-petit)

## Contacto

- 🌐 **Producto**: [useatiende.ai](https://useatiende.ai)
- 📩 **DMs abiertos**: [x.com/javiercamarapp](https://x.com/javiercamarapp)
- 💼 **LinkedIn**: [Javier Cámara Porte Petit](https://www.linkedin.com/in/javier-cámara-porte-petit)

Si estás invirtiendo en LATAM × agentic AI × vertical SaaS, hablemos.

## License

Propietario. © atiende.ai 2026. Uso comercial requiere acuerdo firmado.

El repo es público para que partners early y colaboradores puedan revisar el sistema — no es OSS.

---

<sub>Built in public. Shipping daily. Long-term.</sub>
