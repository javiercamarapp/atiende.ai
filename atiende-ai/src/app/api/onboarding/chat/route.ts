// POST /api/onboarding/chat
// AI-native onboarding conversation. Instead of a rigid one-question-at-a-time
// flow, we give the model the full question checklist + vertical metadata for
// context, and let it conduct a natural conversation in Mexican Spanish.
//
// The model decides what to ask next, when to drop insights/stats, and returns
// a structured JSON with the next message + the updated answers map.

import { NextRequest, NextResponse } from 'next/server';
import { openrouter, MODELS } from '@/lib/llm/openrouter';
import {
  getVerticalQuestions,
  getVerticalMetadata,
  VERTICAL_NAMES,
} from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';
import { logger } from '@/lib/logger';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  vertical: VerticalEnum;
  history: ChatTurn[];
  answers: Record<string, string>;
}

interface ChatResponsePayload {
  message: string;
  answers: Record<string, string>;
  isComplete: boolean;
  progress: { collected: number; total: number };
}

function buildSystemPrompt(vertical: VerticalEnum): string {
  const questions = getVerticalQuestions(vertical);
  const metadata = getVerticalMetadata(vertical);
  const displayName = VERTICAL_NAMES[vertical];

  // Checklist the AI must fill — each question is a field with a key, a
  // human description, and whether it's required. The AI picks natural
  // phrasing; we only care that each required key gets a non-empty value.
  const checklist = questions
    .map((q, i) => {
      const key = `q${i + 1}`;
      const required = q.required ? '[REQUERIDO]' : '[opcional]';
      return `- ${key} ${required} ${q.text}${q.why ? ` — contexto interno: ${q.why}` : ''}`;
    })
    .join('\n');

  // Insights / stats the AI can drop naturally while conversing
  const insights = questions
    .filter((q) => q.followUpInsight)
    .map((q) => `• ${q.followUpInsight}`)
    .join('\n');

  const topFaqs = metadata?.topFaqs?.length
    ? `Top preguntas frecuentes de clientes en este rubro (para que hables con autoridad):\n${metadata.topFaqs.map((f) => `• ${f}`).join('\n')}`
    : '';

  const crisisProtocols = metadata?.crisisProtocols?.length
    ? `Protocolos de crisis a mencionar si aplica:\n${metadata.crisisProtocols.map((c) => `• ${c}`).join('\n')}`
    : '';

  return `Eres el asistente de onboarding de atiende.ai, una plataforma de agentes AI para negocios mexicanos.

Tu personalidad: calido, cercano, consultor experimentado. Hablas como un mexicano real, no como un formulario. Das un insight o una estadistica util de vez en cuando para que el dueno del negocio sienta que estas aportando valor.

El usuario tiene un negocio de tipo: ${displayName}.

Tu mision: recolectar los siguientes datos en una conversacion natural. NO los pidas en orden rigido ni los numeres. NO digas "pregunta 1 de 17". NO listes todas las preguntas al mismo tiempo. Pide UNA cosa a la vez, y varia el fraseo cada turno (ej: "cuentame...", "ahora dime...", "una mas rapida:", "genial, siguiente:").

CHECKLIST DE DATOS A RECOLECTAR (fields):
${checklist}

INSIGHTS Y ESTADISTICAS QUE PUEDES MENCIONAR NATURALMENTE (no todas de golpe, solo cuando encajen):
${insights || '(ninguno especifico — usa tu conocimiento del rubro)'}

${topFaqs}

${crisisProtocols}

REGLAS ESTRICTAS:
1. Hablas espanol de Mexico, informal pero profesional. Usas "tu" no "usted".
2. Una pregunta a la vez. Mensajes cortos (max 3 oraciones salvo en insights).
3. Cuando el usuario responda, AGRADECE BREVEMENTE o da un mini-insight, luego avanza.
4. Cada cierto tiempo (cada 3-4 turnos) deja caer una estadistica o insight util del rubro.
5. NUNCA inventes datos. Si no sabes algo, no lo digas.
6. Cuando tengas TODOS los campos [REQUERIDO] llenos con respuestas validas, marca isComplete=true y despidete con entusiasmo, diciendo que vas a configurar el agente.
7. Los campos [opcional] los puedes saltar si el usuario dice "no aplica", "no se", o similar.

FORMATO DE RESPUESTA OBLIGATORIO:
Responde SIEMPRE con UN JSON valido con exactamente esta forma, sin texto antes ni despues:
{
  "message": "tu mensaje al usuario (espanol mexicano, 1-3 oraciones)",
  "answers": { "q1": "...", "q2": "...", ... },
  "isComplete": false
}

En "answers" incluye TODAS las respuestas acumuladas hasta ahora (las que ya tenias + las nuevas que extraigas del ultimo mensaje del usuario). Cada key es qN donde N es el numero de pregunta del checklist. Solo incluye campos que tengan respuesta real del usuario.

Si es tu primer mensaje en la conversacion (no hay historial), saluda brevemente y pide el PRIMER dato de forma natural.`;
}

function parseModelJson(raw: string): { message: string; answers: Record<string, string>; isComplete: boolean } | null {
  // The model sometimes wraps JSON in ```json fences — strip them
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/, '')
    .replace(/```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.message !== 'string') return null;
    return {
      message: parsed.message,
      answers: typeof parsed.answers === 'object' && parsed.answers !== null ? parsed.answers : {},
      isComplete: Boolean(parsed.isComplete),
    };
  } catch {
    // Try to find the first { and last } and parse that
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (typeof parsed.message !== 'string') return null;
        return {
          message: parsed.message,
          answers: typeof parsed.answers === 'object' && parsed.answers !== null ? parsed.answers : {},
          isComplete: Boolean(parsed.isComplete),
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { vertical, history = [], answers = {} } = body;

    if (!vertical) {
      return NextResponse.json({ error: 'vertical is required' }, { status: 400 });
    }

    const questions = getVerticalQuestions(vertical);
    if (questions.length === 0) {
      return NextResponse.json({ error: 'unknown vertical' }, { status: 400 });
    }

    const system = buildSystemPrompt(vertical);

    // Inject the current answer state so the model doesn't re-ask
    const stateHint = Object.keys(answers).length > 0
      ? `\n\nESTADO ACTUAL DE ANSWERS: ${JSON.stringify(answers)}`
      : '\n\nESTADO ACTUAL DE ANSWERS: {} (conversacion nueva)';

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: system + stateHint },
      ...history.slice(-20), // cap history to last 20 turns to control tokens
    ];

    // If there's no history yet, send a kickoff user message so the model
    // generates its opening line.
    if (history.length === 0) {
      messages.push({ role: 'user', content: '[Inicio de conversacion, saluda y pide el primer dato.]' });
    }

    const response = await openrouter.chat.completions.create({
      model: MODELS.FREE_CHAT,
      messages,
      max_tokens: 500,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '';
    const parsed = parseModelJson(raw);

    if (!parsed) {
      logger.error('Onboarding chat: failed to parse model JSON', undefined, { raw });
      return NextResponse.json(
        { error: 'Respuesta del modelo invalida. Intenta de nuevo.' },
        { status: 502 },
      );
    }

    // Merge server-side state: keep everything the model returned, but also
    // preserve any previous answers it may have dropped by accident.
    const mergedAnswers = { ...answers, ...parsed.answers };

    // Decide completeness: the model's flag, AND every required field filled.
    const requiredKeys = questions
      .map((q, i) => ({ key: `q${i + 1}`, required: q.required }))
      .filter((q) => q.required)
      .map((q) => q.key);
    const allRequiredFilled = requiredKeys.every(
      (k) => typeof mergedAnswers[k] === 'string' && mergedAnswers[k].trim().length > 0,
    );
    const isComplete = parsed.isComplete && allRequiredFilled;

    const payload: ChatResponsePayload = {
      message: parsed.message,
      answers: mergedAnswers,
      isComplete,
      progress: {
        collected: Object.keys(mergedAnswers).length,
        total: questions.length,
      },
    };

    return NextResponse.json(payload);
  } catch (err) {
    logger.error(
      'Onboarding chat failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json(
      { error: 'Error al procesar la conversacion. Intenta de nuevo.' },
      { status: 500 },
    );
  }
}
