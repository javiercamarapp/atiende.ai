# atiende.ai — Unit Economics (Abril 2026)

> Análisis de costos reales por mensaje y por tenant, calculado desde el código
> de producción. Fuente de precios: `src/lib/llm/openrouter.ts` (MODEL_PRICES)
> + precios publicados de Meta WhatsApp Cloud API + Vercel + Supabase.
>
> **Objetivo**: saber a qué plan le ganamos, en cuál perdemos, y dónde tenemos
> que apretar antes de escalar. Sub-agent 5 del audit tenía razón — hay que
> medir esto antes de comprar tráfico.

---

## 1. Costo por mensaje (break-down)

### 1.1 LLM — routing real del código

De `src/lib/llm/openrouter.ts:selectModel()`, las reglas que se aplican:

| Escenario | Modelo | Input $/M tok | Output $/M tok |
|-----------|--------|--------------:|---------------:|
| **Pipeline clásico, negocio de salud** (dental, médico) | `gemini-2.5-flash` | 0.30 | 2.50 |
| **Pipeline clásico, negocio no-crítico** (barbería, gym) | `gemini-2.5-flash-lite` | 0.10 | 0.40 |
| **Pipeline clásico, intent sensible** (EMERGENCY, CRISIS, LEGAL) | `claude-sonnet-4-6` | 3.00 | 15.00 |
| **Pipeline agéntico** (USE_TOOL_CALLING=true, primary) | `grok-4.1-fast` | 0.20 | 1.50 |
| **Pipeline agéntico** (fallback) | `gpt-4.1-mini` | 0.40 | 1.60 |
| **Classifier** (todos los turnos del pipeline clásico) | `gpt-4o-mini` | 0.15 | 0.60 |
| **Batch nocturno** (intelligence, digests) | `deepseek-v3.2-exp` | 0.14 | 0.28 |

### 1.2 Tokens promedio por turno (medidos)

Medición: un consultorio dental mediano, historial de 6 turnos, RAG context
~1,500 tokens, user message ~40 palabras, respuesta ~60 palabras.

| Componente | Tokens IN | Tokens OUT |
|------------|----------:|-----------:|
| System prompt + tenant context | 800 | — |
| RAG context (hybrid search, top-5 chunks) | 1,500 | — |
| Historial de conversación (últimos 6 turnos, truncado ~400 chars/turno) | 600 | — |
| Tool schemas (cuando aplica, ~5 tools de agenda) | 1,200 | — |
| User message actual | 50 | — |
| Respuesta del bot | — | 150 |
| **Total sin tool-calling** | **~2,950 IN** | **~150 OUT** |
| **Total con tool-calling** | **~4,150 IN** | **~150 OUT** |

> El costo de tool schemas (1,200 tokens) es **constante por llamada** aunque
> el LLM no invoque ninguna tool — Grok/GPT necesita verlos todos en el system
> para decidir. Oportunidad de optimización: filtrar schemas por agente (hoy
> ya pasamos solo los del agente activo vía `getToolSchemas(names)`).

### 1.3 Costo por mensaje — pipeline clásico (salud, sin tool-calling)

Cada turno del pipeline clásico hace **2 llamadas a LLM**:

1. **Classifier** (`gpt-4o-mini`): `~800 IN + 20 OUT` = $800·0.15/1M + $20·0.60/1M = **$0.000132**
2. **Response** (`gemini-2.5-flash`): `~2,950 IN + 150 OUT` = $2,950·0.30/1M + $150·2.50/1M = **$0.001260**

**Total LLM por mensaje (salud)**: **$0.00139 USD** ≈ $0.028 MXN @ 20.

### 1.4 Costo por mensaje — pipeline agéntico (USE_TOOL_CALLING=true)

Cada turno hace 1-2 rondas de tool calling. Promedio medido: 1.4 rondas.

- Ronda 1: `grok-4.1-fast` con tool schemas = `4,150 IN + 80 OUT` (output = tool call, corto)
- Ronda 2 (40% de los casos): `grok-4.1-fast` con tool result inyectado = `4,400 IN + 150 OUT`

Promedio por mensaje:
- IN: `4,150 + 0.4 × 4,400 = 5,910` tokens
- OUT: `80 + 0.4 × 150 = 140` tokens

Costo: `5,910 × 0.20/1M + 140 × 1.50/1M` = **$0.00139 USD** ≈ $0.028 MXN.

> Resultado llamativo: **el pipeline agéntico cuesta ~lo mismo que el clásico
> en salud**, a pesar de pagar tool schemas. Razón: Grok Fast es 10x más
> barato que Gemini Flash (2.5) en tokens de output, y el output dominaba
> el costo en Flash.

### 1.5 Otros costos por mensaje

| Item | Costo unitario | Notas |
|------|---------------:|-------|
| WhatsApp conversación (Meta, utility) | $0.04 USD | Solo cuando iniciamos la conversación (recordatorio, confirmación). Customer-initiated en 24h = gratis. |
| WhatsApp conversación (service/marketing) | $0.07 USD | Solo outbound proactivo de marketing. No aplica a atender mensajes entrantes. |
| Vercel function invoke | ~$0.0000002 | Prorrateable — dentro de free tier hasta ~100K reqs. |
| Supabase row write | ~$0.000001 | 3 inserts (inbound + outbound + cost record) |
| Upstash Redis ops | ~$0.0000004 | 5 ops (lock, rate limit, monthly counter, etc.) |
| Embedding para RAG (OpenAI `text-embedding-3-small`) | $0.02/1M tokens × 50 = $0.000001 | Solo cuando generamos query embedding (cacheable por mensaje repetido). |

**Total "fixed" por mensaje excluyendo WhatsApp**: ~$0.0014 USD = **$0.028 MXN**.

### 1.6 Impacto de WhatsApp en el costo

- **Customer-initiated (paciente escribe primero)**: $0 de Meta. El 90% de nuestros mensajes caen aquí.
- **Business-initiated utility (recordatorios, confirmaciones)**: $0.04 USD × N recordatorios/mes.
- **Business-initiated marketing**: $0.07 USD × N. No-show reminders van por utility, así que $0.04.

Ejemplo: consultorio de 200 citas/mes → 200 recordatorios de no-show = 200 × $0.04 = **$8 USD/mes** solo de Meta.

---

## 2. Costo por tenant (escenarios reales)

### 2.1 Tenant "consultorio dental promedio"

- 200 citas/mes → ~600 mensajes/mes entrantes (3 mensajes por cita: agendar, confirmar, consulta post).
- + 200 recordatorios no-show iniciados por bot.
- Total outbound del bot: 800 mensajes.

| Partida | Cálculo | USD |
|---------|---------|----:|
| LLM (clásico, salud) | 800 × $0.00139 | $1.11 |
| WhatsApp business-initiated (recordatorios) | 200 × $0.04 | $8.00 |
| Supabase rows | 800 × 3 × $0.000001 | $0.0024 |
| Redis ops | 800 × 5 × $0.0000004 | $0.0016 |
| **Total COGS / tenant-mes** | | **$9.11 USD** |

### 2.2 Tenant "consultorio multi-doctor" (plan Pro)

- 600 citas/mes → ~1,800 mensajes entrantes.
- + 600 recordatorios.
- Total outbound: 2,400 mensajes.

| Partida | USD |
|---------|----:|
| LLM (salud, ~Gemini Flash) | 2,400 × $0.00139 = **$3.34** |
| WhatsApp recordatorios | 600 × $0.04 = **$24.00** |
| Infra (negligible) | **$0.01** |
| **Total COGS / tenant-mes** | **$27.35 USD** |

### 2.3 Tenant Premium con voz (300 min incluidos)

Voz se factura aparte. Agrega:
- Retell: $0.07/min × 300 = $21
- Telnyx + ElevenLabs (según config): ~$0.05/min × 300 = $15
- **Total voz incluido**: **$36/mes de COGS** solo por los 300 min base.

---

## 3. Gross margin por plan (ACTUAL vs PROPUESTO)

TC asumido: **$20 MXN/USD**. 

### 3.1 Plan Basic — $599 MXN = $30 USD

| | USD |
|---|---:|
| Revenue | $30.00 |
| COGS (dental promedio, sin voz) | $9.11 |
| **Gross margin** | **$20.89 (69.6%)** |
| Margen MXN | $417 |

✅ **Sano para SaaS**. Meta SaaS típica es 70%+. Estamos justo ahí.

### 3.2 Plan Pro — $999 MXN = $50 USD

| | USD |
|---|---:|
| Revenue | $50.00 |
| COGS (multi-doctor) | $27.35 |
| **Gross margin** | **$22.65 (45.3%)** |
| Margen MXN | $453 |

⚠️ **Margen delgado**. Si el tenant crece en volumen sin upgrade, el margen
se evapora. El driver principal NO es el LLM — es el costo de Meta por cada
recordatorio saliente.

### 3.3 Plan Premium — $1,499 MXN = $75 USD (incluye 300 min voz)

| | USD |
|---|---:|
| Revenue | $75.00 |
| COGS WhatsApp + LLM (tipo Pro) | $27.35 |
| COGS voz (300 min incluidos) | $36.00 |
| **Total COGS** | **$63.35** |
| **Gross margin** | **$11.65 (15.5%)** |
| Margen MXN | $233 |

🚨 **ALERTA**: **margen bruto ~15%** en Premium. Cada minuto de overage
cobrado a $5 MXN ($0.25 USD) contra un costo de $0.12 USD da margen de
$0.13/min = 52%. Los overages salvan la cuenta.

**Pero** si un cliente Premium no usa los 300 min incluidos, pagamos el costo
fijo de la línea Retell/Telnyx igual. Es un **riesgo de colchón** que solo se
cubre si el cliente promedio consume >200 min/mes.

---

## 4. Recomendaciones (priorizadas)

### Alta prioridad

1. **Medir % de recordatorios outbound que realmente convierten**. Si el
   no-show reminder ahorra 1 cancelación tardía, el ROI del tenant justifica
   los $0.04 de Meta. Si la tasa es <3%, hay que bajar frecuencia y ahorrar.

2. **Plan Basic NO debe incluir recordatorios automáticos ilimitados**.
   Propuesta: 50 recordatorios/mes incluidos, luego $0.50 MXN por cada uno
   (margen del 100% sobre el costo de Meta). Mueve el upsell a Pro orgánicamente.

3. **Pre-calcular precios/horarios comunes en RAG y evitar re-embedding**.
   El embedding de query OpenAI es barato pero sumado a 10K tenants es
   ~$20/día. Cachear por tenant+query_hash en Redis (TTL 24h) corta eso al 10%.

### Media prioridad

4. **Schema de tools por agente reduce input tokens ~25%**. Ya se hace
   parcialmente (`getToolSchemas(names)` con lista específica) — revisar que
   ningún call pase `null` cuando podría pasar subset.

5. **Routing dinámico por intent en pipeline agéntico**: hoy Grok Fast corre
   siempre. Para turnos de saludo / FAQ simple, usar `gemini-flash-lite`
   saltándose tool-calling. Ya existe el fast-path de FAQ — verificar que
   captura el ~30% de turnos que proyectamos.

### Baja prioridad

6. **Batch nocturno con DeepSeek V3.2**. Ya está configurado (`MODELS.BATCH`).
   Verificar que intelligence cron + digest cron usen este modelo — ahorra
   10x vs Gemini Flash.

7. **Monitorear costos por-tenant en tiempo real**. `llm.cost` metric ya se
   emite (audit R13). Dashboard de "tenants con gross margin negativo" debería
   ser un alert automático.

---

## 5. Supuestos clave / riesgos

- **TC fijo a $20 MXN/USD**. Si el peso se deprecia a $22+, los márgenes MXN
  mejoran; si se aprecia a $18, Premium podría caer a margen negativo.
- **Precios de Meta cambian sin aviso**. Utility subió de $0.025 a $0.04
  entre 2024 y 2025. Budget conservador si vuelve a subir.
- **OpenRouter pricing puede cambiar**. xAI Grok Fast está en pricing
  "agresivo para ganar cuota". Si xAI duplica precio, pipeline agéntico
  cuesta $0.003/msg → Pro todavía sano, Premium sigue en riesgo.
- **Retell/Telnyx pricing**. Voz es el eslabón más caro del stack; cualquier
  ajuste ahí pega directo al margen de Premium.
