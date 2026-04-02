import { generateResponse, selectModel } from '@/lib/llm/openrouter';
import { validateResponse } from '@/lib/guardrails/validate';

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

  const model = selectModel(intent, tenant.business_type, tenant.plan);
  const systemPrompt = buildSystemPrompt(tenant, ragContext, intent, customerName);

  const startTime = Date.now();

  const result = await generateResponse({
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
  });

  const responseTimeMs = Date.now() - startTime;

  const validation = validateResponse(result.text, tenant, ragContext, content);

  return {
    text: validation.text,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cost: result.cost,
    responseTimeMs,
    confidence: validation.valid ? 0.9 : 0.3,
  };
}

// ── System prompt construction ──────────────────────────────

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
