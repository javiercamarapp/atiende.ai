import OpenAI from 'openai';

// OpenRouter usa la misma interfaz que OpenAI SDK
export const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://atiende.ai',
    'X-Title': 'atiende.ai',
  },
});

// ═══ MODELOS MARZO 2026 — MEJOR CALIDAD-PRECIO ═══
// Gemini 2.5 Flash como workhorse + Claude para sensible
export const MODELS = {
  // ─── CLASIFICAR INTENT (cada mensaje) ───
  // GPT-5 Nano: $0.05/$0.40 — el MAS barato del mercado
  // Solo responde 1 palabra. 100K clasificaciones ≈ $4.50/mes
  CLASSIFIER: 'openai/gpt-5-nano',

  // ─── CHAT CASUAL / FAQ (70% del trafico) ───
  // Gemini 2.5 Flash-Lite: $0.10/$0.40 — 75% mas barato que GPT-4.1-mini
  // Ultra baja latencia, buen espanol, 1M contexto
  // PARA: horarios, ubicacion, precios, info general
  STANDARD: 'google/gemini-2.5-flash-lite',

  // ─── CHAT PROFESIONAL (20% del trafico) ───
  // Gemini 2.5 Flash: $0.30/$2.50 — workhorse de Google
  // Razonamiento avanzado, 1M contexto, multilingue excelente
  // PARA: agendar citas multi-step, pedidos complejos, leads BANT
  BALANCED: 'google/gemini-2.5-flash',

  // ─── TEMAS SENSIBLES (10% del trafico) ───
  // Claude Sonnet 4.6: $3.00/$15.00 — maximo safety
  // Mejor anti-alucinacion. No diagnostica, no receta.
  // PARA: quejas, emergencias, preguntas medicas, crisis mental,
  //       temas legales, creditos hipotecarios
  PREMIUM: 'anthropic/claude-sonnet-4-6',

  // ─── VOICE AGENT ───
  // Gemini 2.5 Flash-Lite: ultra baja latencia para voz real-time
  VOICE: 'google/gemini-2.5-flash-lite',

  // ─── GENERAR PROMPTS (onboarding) ───
  // Gemini 2.5 Flash: buen seguimiento de instrucciones largas
  GENERATOR: 'google/gemini-2.5-flash',
} as const;

// Precios por millon de tokens [input, output]
const MODEL_PRICES: Record<string, [number, number]> = {
  'openai/gpt-5-nano': [0.05, 0.40],
  'google/gemini-2.5-flash-lite': [0.10, 0.40],
  'google/gemini-2.5-flash': [0.30, 2.50],
  'anthropic/claude-sonnet-4-6': [3.00, 15.00],
};

// ═══ ROUTING POR TIPO DE NEGOCIO + INTENT ═══
// La logica: negocios de SALUD siempre usan modelo medio
// (riesgo de alucinacion medica = inaceptable)
// Negocios de bajo riesgo (taqueria, gym) usan Flash-Lite
// Temas sensibles SIEMPRE van a Claude (no negociable)
export function selectModel(
  intent: string,
  businessType: string,
  plan: string
): string {
  // ── REGLA 1: Plan premium → siempre balanced ──
  if (plan === 'premium') return MODELS.BALANCED;

  // ── REGLA 2: Intents sensibles → Claude (no negociable) ──
  const sensitiveIntents = [
    'EMERGENCY', 'COMPLAINT', 'HUMAN', 'CRISIS',
    'MEDICAL_QUESTION', 'LEGAL_QUESTION'
  ];
  if (sensitiveIntents.includes(intent)) return MODELS.PREMIUM;

  // ── REGLA 3: Negocios de SALUD → Gemini Flash (balanced) ──
  // Porque si alucina un precio de cirugia o un medicamento = problema
  const healthTypes = [
    'dental', 'medical', 'nutritionist', 'psychologist',
    'dermatologist', 'gynecologist', 'pediatrician',
    'ophthalmologist'
  ];
  if (healthTypes.includes(businessType)) return MODELS.BALANCED;

  // ── REGLA 4: Inmobiliaria con temas de credito → balanced ──
  if (businessType === 'real_estate' &&
      ['APPOINTMENT_NEW', 'PRICE', 'LEGAL_QUESTION'].includes(intent)) {
    return MODELS.BALANCED;
  }

  // ── REGLA 5: Veterinaria emergencia → Claude ──
  if (businessType === 'veterinary' && intent === 'EMERGENCY') {
    return MODELS.PREMIUM;
  }

  // ── REGLA 6: Agendamiento/pedidos complejos → balanced ──
  if (['APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'ORDER_NEW',
       'RESERVATION'].includes(intent)) {
    return MODELS.BALANCED;
  }

  // ── REGLA 7: Todo lo demas → Flash-Lite (ultra barato) ──
  // Horarios, ubicacion, FAQ simples, saludos, despedidas
  return MODELS.STANDARD;
}

// Calcular costo de una request
export function calculateCost(
  model: string, tokensIn: number, tokensOut: number
): number {
  const [rateIn, rateOut] = MODEL_PRICES[model] || [1.0, 5.0];
  return (tokensIn * rateIn + tokensOut * rateOut) / 1_000_000;
}

// Helper: generar respuesta con OpenRouter
export async function generateResponse(opts: {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}) {
  const response = await openrouter.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      ...opts.messages,
    ],
    max_tokens: opts.maxTokens || 400,
    temperature: opts.temperature || 0.5,
  });

  return {
    text: response.choices[0].message.content || '',
    model: response.model || opts.model,
    tokensIn: response.usage?.prompt_tokens || 0,
    tokensOut: response.usage?.completion_tokens || 0,
    cost: calculateCost(
      opts.model,
      response.usage?.prompt_tokens || 0,
      response.usage?.completion_tokens || 0
    ),
  };
}
