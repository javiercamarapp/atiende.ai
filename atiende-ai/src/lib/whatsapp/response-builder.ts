import { generateResponse, selectModel } from '@/lib/llm/openrouter';
import { validateResponse, pickFallback } from '@/lib/guardrails/validate';
import { RESPONSE_GENERATION_TIMEOUT_MS } from '@/lib/config';
import { trackFallback, trackLLMCall } from '@/lib/monitoring';

interface TenantRecord {
  id: string;
  name: string;
  status: string;
  plan: string;
  business_type?: string;
  wa_phone_number_id: string;
  welcome_message?: string;
  chat_system_prompt?: string;
  temperature?: number;
  address?: string;
  [key: string]: unknown;
}

interface GeneratedResponse {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  responseTimeMs: number;
  confidence: number;
}

/**
 * Generates an LLM response grounded in RAG context,
 * validates it against hallucination guardrails, and returns
 * the final text along with usage metrics.
 */
export async function generateAndValidateResponse(opts: {
  tenant: TenantRecord;
  intent: string;
  ragContext: string;
  history: Array<{ direction: string; content: string | null }>;
  customerName?: string | null;
  content: string;
}): Promise<GeneratedResponse> {
  const { tenant, intent, ragContext, history, customerName, content } = opts;

  const model = selectModel(intent, tenant.business_type || 'other', tenant.plan || 'free_trial');
  const systemPrompt = buildSystemPrompt(tenant, ragContext, intent, customerName);

  const startTime = Date.now();

  let result: { text: string; model: string; tokensIn: number; tokensOut: number; cost: number };
  try {
    result = await Promise.race([
      generateResponse({
        model,
        system: systemPrompt,
        messages: history
          .filter((m) => m.content)
          .map((m) => ({
            role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content!,
          })),
        maxTokens: 400,
        temperature: tenant.temperature || 0.5,
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`LLM response timeout after ${RESPONSE_GENERATION_TIMEOUT_MS}ms`)), RESPONSE_GENERATION_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // LLM timeout, provider error, o network fail. No tiramos el error arriba
    // porque eso deja al usuario sin respuesta. Devolvemos fallback contextual
    // (loggeado para observabilidad) con welcome_message del tenant si es
    // GREETING y lo tiene configurado.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[response-builder] LLM generation failed — falling back', {
      intent, model, errMsg,
    });
    trackFallback('llm_generation_failed', tenant.id);
    const fallbackText = intent === 'GREETING' && tenant.welcome_message
      ? tenant.welcome_message
      : pickFallback(intent);
    return {
      text: fallbackText,
      model,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      responseTimeMs: Date.now() - startTime,
      confidence: 0.1,
    };
  }

  const responseTimeMs = Date.now() - startTime;

  // Track el LLM call exitoso. Es CRÍTICO que ocurra acá y no en openrouter.ts
  // porque en openrouter no tenemos tenantId — el dashboard de costos por
  // tenant necesita este track para atribuir tokens/$.
  trackLLMCall(result.model, responseTimeMs, result.cost, tenant.id);

  const validation = validateResponse(
    result.text,
    { business_type: String(tenant.business_type || 'other'), name: String(tenant.name || '') },
    ragContext,
    content,
    intent,
  );

  // Defensa en profundidad: si por cualquier razón validation.text queda
  // vacío, usamos welcome_message del tenant para GREETING o fallback por
  // intent. Evita que el caller reciba "" y termine enviando "Hola" pelado.
  const needsFallback = !validation.text || !validation.text.trim();
  const finalText = needsFallback
    ? (intent === 'GREETING' && tenant.welcome_message
      ? tenant.welcome_message
      : pickFallback(intent))
    : validation.text;

  if (needsFallback) {
    trackFallback('validation_empty', tenant.id);
  }

  return {
    text: finalText,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cost: result.cost,
    responseTimeMs,
    confidence: validation.valid ? 0.9 : 0.3,
  };
}

// -- System prompt construction --

function buildSystemPrompt(
  tenant: TenantRecord,
  ragContext: string,
  intent: string,
  customerName?: string | null,
): string {
  return `${tenant.chat_system_prompt || getDefaultPrompt(tenant)}

═══ CONTEXTO DEL NEGOCIO (usa SOLO esta informacion para responder) ═══
${ragContext}

═══ REGLAS DE ESTA RESPUESTA ═══
INTENT DETECTADO: ${intent}
${customerName ? `NOMBRE DEL CLIENTE: ${customerName}` : ''}
- Responde en MAXIMO 3-4 oraciones
- Si no tienes info: "Permitame verificar con el equipo"
- NUNCA inventes datos, precios, horarios
- Usa los precios EXACTOS del contexto
- Espanol mexicano, "usted" siempre`;
}

function getDefaultPrompt(tenant: TenantRecord): string {
  return `Eres el asistente virtual de ${tenant.name}${tenant.address ? ` en ${tenant.address}` : ''}.
Hablas espanol mexicano natural. Usas "usted" siempre.
Eres calido, profesional y servicial.
Tu trabajo: informar sobre servicios, precios, horarios, y agendar citas.
Si no sabes algo: "Permitame verificar con el equipo y le confirmo."
NUNCA diagnostiques, recetes, ni des asesoria medica/legal.
Ofrece siempre: "Si prefiere hablar con una persona, con gusto le comunico."`;
}
