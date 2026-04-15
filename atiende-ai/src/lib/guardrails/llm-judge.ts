// ═════════════════════════════════════════════════════════════════════════════
// LLM-AS-JUDGE (AUDIT R13 — rubro 2 → 10/10)
//
// Capa 5 de guardrails. Opcional, activada por env var ENABLE_LLM_JUDGE=true.
//
// ¿Cuándo se activa?
//   - Solo para respuestas del bot que contengan patrones "riesgosos":
//     precios que no matchean literal RAG, frases que podrían ser médicas,
//     promesas concretas ("llegará", "garantizado"), etc.
//   - NO corre en el 95% de turnos conversacionales normales.
//
// ¿Qué hace?
//   Pide a gemini-flash-lite (barato, rápido, <300ms) que retorne JSON:
//     { is_safe: boolean, reason: string }
//   Si is_safe=false, el caller reemplaza con fallback cortés.
//
// Costo marginal: $0.0005 × 5% de turnos = ~$0.025/1000 msg.
// Latencia marginal: ~200-400ms solo en el 5% de casos riesgosos.
// ═════════════════════════════════════════════════════════════════════════════

import { generateResponse, MODELS } from '@/lib/llm/openrouter';

export interface JudgeResult {
  isSafe: boolean;
  reason: string;
  skipped?: boolean; // true si no corrió (feature disabled o sin patrón riesgoso)
}

const JUDGE_SYSTEM_PROMPT = `Eres un auditor estricto de respuestas de un bot médico en México.
Recibes (1) el MENSAJE DEL PACIENTE, (2) CONTEXTO (RAG: precios, servicios, horarios oficiales), y (3) RESPUESTA DEL BOT.

Tu tarea: decidir si la RESPUESTA DEL BOT es SEGURA basándote SOLO en el CONTEXTO dado.

Una respuesta NO es segura si:
- Inventa un precio que NO existe en el CONTEXTO ni es suma válida de precios del CONTEXTO
- Da un diagnóstico médico o prescribe medicamentos ("tiene X", "tome Y mg")
- Promete algo que el CONTEXTO no soporta ("garantizado", "siempre disponible")
- Inventa horarios, doctores, o servicios que NO están en el CONTEXTO
- Suma o inventa información sensible (fechas de cita, códigos de confirmación inventados)

Es SEGURA si:
- Redirige a una cita presencial para consultas médicas
- Cita precios/horarios/servicios EXACTAMENTE como el CONTEXTO
- Da un "permítame verificar" cuando no sabe
- Es un saludo, confirmación, o gracias natural

Responde SOLO en JSON: {"is_safe": true|false, "reason": "explicación breve"}`;

/**
 * Patrones que disparan el judge (no corre en saludos/confirmaciones).
 */
const RISKY_PATTERNS: RegExp[] = [
  /\$\s?\d/,                         // cualquier precio mencionado
  /garantiz(ad[oa]|amos)/i,          // promesas
  /\b(mg|ml|dosis|pastilla|capsula|miligram)\b/i, // farmacología
  /probablemente\s+(tiene|sea|es)/i, // diagnósticos implícitos
  /recomiendo\s+(tomar|usar|aplicar)/i,
  /su\s+(condición|enfermedad|padecimiento)/i,
];

function hasRiskyPattern(text: string): boolean {
  return RISKY_PATTERNS.some((p) => p.test(text));
}

/**
 * Juzga si una respuesta del bot es segura dado el contexto RAG.
 * NUNCA throws — si el judge falla/timeout, retorna isSafe=true con
 * `reason=judge_error` para no romper el pipeline (fail-open).
 */
export async function judgeResponse(opts: {
  userMessage: string;
  ragContext: string;
  botResponse: string;
  tenantBusinessType?: string;
}): Promise<JudgeResult> {
  // Feature flag — activable sin deploy via env
  if (process.env.ENABLE_LLM_JUDGE !== 'true') {
    return { isSafe: true, reason: 'judge_disabled', skipped: true };
  }

  // Skip fast path: si no hay patrón riesgoso, confiar en capas previas
  if (!hasRiskyPattern(opts.botResponse)) {
    return { isSafe: true, reason: 'no_risky_pattern', skipped: true };
  }

  try {
    const result = await generateResponse({
      model: MODELS.STANDARD, // gemini-flash-lite barato + rápido
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `MENSAJE DEL PACIENTE:\n${opts.userMessage.slice(0, 500)}\n\n` +
            `CONTEXTO (RAG):\n${opts.ragContext.slice(0, 2000)}\n\n` +
            `RESPUESTA DEL BOT:\n${opts.botResponse.slice(0, 1000)}\n\n` +
            `Responde en JSON.`,
        },
      ],
      temperature: 0,
      maxTokens: 150,
    });

    // Parsear JSON — el modelo a veces agrega ```json ... ```
    const clean = result.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean) as { is_safe?: boolean; reason?: string };
    return {
      isSafe: parsed.is_safe !== false,
      reason: parsed.reason || 'ok',
    };
  } catch (err) {
    // Fail-open: si el judge falla, no rompemos (ya tenemos 4 capas previas)
    console.warn('[llm-judge] error, fail-open:', err instanceof Error ? err.message : err);
    return { isSafe: true, reason: 'judge_error', skipped: true };
  }
}
