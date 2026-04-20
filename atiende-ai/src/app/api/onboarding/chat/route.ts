import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runChatAgent } from '@/lib/onboarding/chat-agent';
import { scrapeUrl, extractFirstUrl, ScrapeError } from '@/lib/onboarding/scrape';
import {
  allRequiredFilled,
  countCapturedRequired,
  countRequired,
  getNextPendingRequiredQuestion,
} from '@/lib/onboarding/vertical-schema-for-agent';
import { ALL_VERTICALS, isActiveVertical } from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';
import { getVerticalInsight } from '@/lib/onboarding/vertical-insights';

// Formal rejection message shown when the detected vertical is in standby.
// Mirrors the prompt rule in chat-agent.ts so the server enforces the same
// behavior even if the LLM misbehaves.
const STANDBY_REJECTION_MESSAGE =
  'Gracias por escribirnos. Por el momento useatiende.ai está enfocado exclusivamente en agentes de reservas para los sectores de salud y estética — médicos, dentistas, psicólogos, estilistas, spas, gimnasios y similares. Estaremos habilitando más industrias próximamente. Si gustas, déjame tu nombre, correo o WhatsApp y te avisamos cuando tu sector esté disponible.';
import { logger } from '@/lib/logger';
import { StructuredGenerationError } from '@/lib/llm/openrouter';

export const runtime = 'nodejs';
// Vercel function timeout. Pro default is 15s — not enough for this route
// because it may scrape a URL, extract content, then call the Qwen 235B
// onboarding LLM, which together can take 20-40s in the worst case.
// Setting to 60s (within Pro's 300s cap) gives headroom without blowing the
// LLM budget. If this fires, investigate — something is slower than expected.
export const maxDuration = 60;

const ChatRequestSchema = z.object({
  vertical: z
    .enum(ALL_VERTICALS as [VerticalEnum, ...VerticalEnum[]])
    .nullable()
    .optional(),
  capturedFields: z.record(z.string(), z.string()).default({}),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    // Cap kept generous because runChatAgent already slices to the last 20
    // turns before calling the LLM. A real onboarding easily reaches 40+
    // entries (the agent emits up to 3 bubbles per turn), so the old .max(40)
    // was rejecting valid long sessions with 400 and killing progress.
    .max(200)
    .default([]),
  userMessage: z.string().min(1).max(4000),
  uploadedContent: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        markdown: z.string().min(1).max(30_000),
      }),
    )
    .max(5)
    .optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { userMessage, history, capturedFields, uploadedContent } = parsed.data;
  const incomingVertical = parsed.data.vertical ?? null;

  // ── 1. Detect URL in the user message and scrape it (best-effort) ──
  let scrapedMarkdown: string | undefined;
  let scrapeError: string | undefined;
  let scrapedUrl: string | undefined;
  const maybeUrl = extractFirstUrl(userMessage);
  if (maybeUrl) {
    try {
      const scrape = await scrapeUrl(maybeUrl);
      scrapedMarkdown = scrape.markdown;
      scrapedUrl = scrape.url;
    } catch (err) {
      if (err instanceof ScrapeError) {
        scrapeError = `${err.code}: ${err.message}`;
      } else {
        scrapeError = `UNKNOWN: ${(err as Error).message}`;
      }
      logger.warn('onboarding_chat scrape failed', {
        url: maybeUrl,
        error: scrapeError,
      });
    }
  }

  // ── 2. Run the agent turn ──
  try {
    const agentResult = await runChatAgent({
      vertical: incomingVertical,
      capturedFields,
      history,
      userMessage,
      scrapedMarkdown,
      scrapeError,
      uploadedContent,
    });

    // ── 3. Merge captured fields (only valid keys, filtered by runChatAgent) ──
    const mergedFields: Record<string, string> = {
      ...capturedFields,
      ...agentResult.updatedFields,
    };

    // ── 4. Re-validate `done`: only trust if all required fields are present ──
    const effectiveVertical = agentResult.vertical ?? incomingVertical;

    const verticalJustDetected =
      incomingVertical === null && effectiveVertical !== null;

    // ── 4a. STANDBY GATE — If the agent detected a vertical that's not in
    // ACTIVE_VERTICALS (e.g. restaurante, abarrotes, condominio), override
    // the entire response with the formal rejection. This prevents:
    //   (1) leaking insight copy for industries we don't support yet
    //   (2) the LLM hallucinating a vertical when scrape fails and then the
    //       server showing an unrelated insight as bubble 1
    const detectedStandbyVertical =
      effectiveVertical !== null && !isActiveVertical(effectiveVertical);

    let doneFinal: boolean;
    let finalAssistantMessages: string[];
    let rejectedCapturedFields = mergedFields;

    if (detectedStandbyVertical) {
      finalAssistantMessages = [STANDBY_REJECTION_MESSAGE];
      doneFinal = true;
      rejectedCapturedFields = {}; // don't leak partial data
      logger.info('onboarding_chat standby_rejection', {
        detected_vertical: effectiveVertical,
      });
    } else {
      doneFinal =
        agentResult.done &&
        effectiveVertical !== null &&
        allRequiredFilled(effectiveVertical, mergedFields);

      // ── 4b. Inject industry insight on the turn where the vertical is newly
      // detected. The insight is prepended to the agent's own messages so the
      // user sees: [1] industry stat + value prop, [2] LLM's acknowledge,
      // [3] LLM's next question. Capped at 3 total bubbles.
      finalAssistantMessages = verticalJustDetected
        ? [
            getVerticalInsight(effectiveVertical!),
            ...agentResult.assistantMessages,
          ].slice(0, 3)
        : agentResult.assistantMessages;
    }

    // ── 4c. Dead-end recovery. The agent prompt's most important rule says
    // "never answer with just an acknowledgement — always include the next
    // question in the same turn". When the LLM violates it (e.g. "Perfecto,
    // anotado: Dr. Javier, Cirujano Dentista." with no follow-up), the user
    // is stranded: the last bubble has no '?' so they have no idea what to
    // type next. Detect that case and append the next pending required
    // question from the schema directly. This makes progress deterministic
    // even when the LLM misbehaves. Skipped for standby rejections because
    // those intentionally end without a question.
    const lastMsg = finalAssistantMessages[finalAssistantMessages.length - 1] ?? '';
    const hasQuestion = /[?¿]/.test(lastMsg);
    if (!detectedStandbyVertical && !doneFinal && !hasQuestion && effectiveVertical) {
      const next = getNextPendingRequiredQuestion(effectiveVertical, mergedFields);
      if (next) {
        finalAssistantMessages = [...finalAssistantMessages, next.text];
        // Keep the cap at 3 bubbles per turn (trim oldest if we overflowed).
        if (finalAssistantMessages.length > 3) {
          finalAssistantMessages = finalAssistantMessages.slice(
            finalAssistantMessages.length - 3,
          );
        }
        logger.warn('onboarding_chat dead_end_recovery', {
          vertical: effectiveVertical,
          injectedFieldKey: next.key,
        });
      }
    }

    // ── 5. Log telemetry — counts and cost only, never PII ──
    logger.info('onboarding_chat_turn', {
      vertical: effectiveVertical,
      model: agentResult.model,
      tokensIn: agentResult.tokensIn,
      tokensOut: agentResult.tokensOut,
      cost: agentResult.cost,
      capturedRequired: effectiveVertical
        ? countCapturedRequired(effectiveVertical, mergedFields)
        : 0,
      totalRequired: effectiveVertical ? countRequired(effectiveVertical) : 0,
      fieldsAddedThisTurn: Object.keys(agentResult.updatedFields).length,
      clarificationOf: agentResult.clarificationOf,
      scrapeSucceeded: scrapedMarkdown !== undefined,
      scrapeFailed: scrapeError !== undefined,
      uploadsProvided: uploadedContent?.length ?? 0,
      assistantMessageCount: finalAssistantMessages.length,
      verticalJustDetected,
      done: doneFinal,
    });

    return NextResponse.json({
      vertical: effectiveVertical,
      capturedFields: rejectedCapturedFields,
      assistantMessages: finalAssistantMessages,
      done: doneFinal,
      clarificationOf: detectedStandbyVertical ? null : agentResult.clarificationOf,
      totalRequired:
        effectiveVertical && !detectedStandbyVertical
          ? countRequired(effectiveVertical)
          : 0,
      capturedRequired:
        effectiveVertical && !detectedStandbyVertical
          ? countCapturedRequired(effectiveVertical, rejectedCapturedFields)
          : 0,
      verticalJustDetected,
      scrape: maybeUrl
        ? {
            url: scrapedUrl ?? maybeUrl,
            succeeded: scrapedMarkdown !== undefined,
            error: scrapeError,
          }
        : undefined,
    });
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      // StructuredGenerationError carries two diagnostic fields (.cause and
      // .lastRawContent) that don't round-trip through the default logger
      // serialization. Extract them explicitly so Vercel logs show the actual
      // failure mode (ZodError / parse error / underlying OpenRouter API
      // error) and the raw LLM output that wouldn't parse.
      const underlying = err.cause;
      const underlyingMessage =
        underlying instanceof Error
          ? underlying.message
          : underlying !== undefined
            ? String(underlying)
            : undefined;
      const underlyingName =
        underlying instanceof Error ? underlying.name : undefined;
      logger.error('onboarding_chat agent failed', err, {
        vertical: incomingVertical,
        underlyingName,
        underlyingMessage,
        lastRawContent: err.lastRawContent?.slice(0, 2000),
        hadUrl: maybeUrl !== null,
        scrapedOk: scrapedMarkdown !== undefined,
        scrapeError,
      });

      // Context-aware fallback so the user has an actionable next step
      // instead of the generic "Se me trabó un segundo" dead-end.
      let fallback: string;
      if (maybeUrl && scrapeError) {
        fallback = `No pude leer el contenido de ${maybeUrl}. ¿Puedes describirme tu negocio con palabras? Por ejemplo: "Soy dentista en Mérida, ofrezco 3 servicios, abro L–V de 9 a 6".`;
      } else if (maybeUrl && scrapedMarkdown) {
        fallback =
          'Leí tu sitio web pero tuve un problema procesando la info. ¿Puedes contarme en una frase qué servicios ofreces y en qué ciudad estás?';
      } else {
        fallback =
          'Se me trabó un segundo, ¿puedes repetirme lo último en una sola oración?';
      }

      return NextResponse.json(
        {
          error: 'agent_failed',
          assistantMessages: [fallback],
        },
        { status: 500 },
      );
    }
    logger.error('onboarding_chat unexpected error', err as Error, {
      vertical: incomingVertical,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
