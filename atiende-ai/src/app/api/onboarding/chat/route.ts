import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runChatAgent } from '@/lib/onboarding/chat-agent';
import { scrapeUrl, extractFirstUrl, ScrapeError } from '@/lib/onboarding/scrape';
import {
  allRequiredFilled,
  countCapturedRequired,
  countRequired,
} from '@/lib/onboarding/vertical-schema-for-agent';
import { ALL_VERTICALS } from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';
import { logger } from '@/lib/logger';
import { StructuredGenerationError } from '@/lib/llm/openrouter';

export const runtime = 'nodejs';

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
    .max(40)
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
    const doneFinal =
      agentResult.done &&
      effectiveVertical !== null &&
      allRequiredFilled(effectiveVertical, mergedFields);

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
      done: doneFinal,
    });

    return NextResponse.json({
      vertical: effectiveVertical,
      capturedFields: mergedFields,
      assistantMessage: agentResult.assistantMessage,
      done: doneFinal,
      clarificationOf: agentResult.clarificationOf,
      totalRequired: effectiveVertical ? countRequired(effectiveVertical) : 0,
      capturedRequired: effectiveVertical
        ? countCapturedRequired(effectiveVertical, mergedFields)
        : 0,
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
      logger.error('onboarding_chat agent failed', err, {
        vertical: incomingVertical,
      });
      return NextResponse.json(
        {
          error: 'agent_failed',
          assistantMessage:
            'Se me trabó un segundo, ¿puedes repetirme lo último en una sola oración?',
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
