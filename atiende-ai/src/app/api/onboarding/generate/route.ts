import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateAgentConfig } from '@/lib/onboarding/generate-agent';
import { verticalToBusinessType } from '@/lib/onboarding/business-type-map';
import { ALL_VERTICALS } from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const GenerateRequestSchema = z.object({
  vertical: z.enum(ALL_VERTICALS as [VerticalEnum, ...VerticalEnum[]]),
  answers: z.record(z.string(), z.string()),
  // Allow empty — the client may send '' if the conversational agent never
  // captured q1 explicitly. We fall back to "Mi negocio" server-side.
  businessName: z.string().max(255).default(''),
});

export async function POST(request: Request) {
  // ── 1. Auth ──
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse + validate body ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { vertical, answers } = parsed.data;
  const businessName = parsed.data.businessName || answers.q1 || 'Mi negocio';

  // ── 3. Build agent config (system prompt + metadata rules) ──
  const config = generateAgentConfig(vertical, answers, businessName);
  const dbBusinessType = verticalToBusinessType(vertical);

  // ── 4. Persist to tenants (upsert by user_id — idempotent on re-runs) ──
  // Uses supabaseAdmin to bypass RLS; we already verified the user above and
  // set user_id explicitly, so the write is still tied to the authenticated
  // caller.
  const tenantRow = {
    user_id: user.id,
    name: businessName,
    business_type: dbBusinessType,
    email: user.email ?? null,
    chat_system_prompt: config.systemPrompt,
    bot_name: 'Asistente',
    status: 'active' as const,
    config: {
      vertical, // fine-grained VerticalEnum, preserved for LLM routing
      neverHallucinate: config.neverHallucinate,
      crisisProtocols: config.crisisProtocols,
      topFaqs: config.topFaqs,
      capturedAt: new Date().toISOString(),
      answersRaw: answers,
    },
  };

  // Look up existing tenant (upsert by user_id, since tenants has no unique
  // constraint on user_id we do it manually for correctness).
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (lookupError) {
    logger.error('onboarding_generate tenant lookup failed', lookupError as Error, {
      userId: user.id,
    });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  let tenantId: string;
  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update(tenantRow)
      .eq('id', existing.id);
    if (updateError) {
      logger.error('onboarding_generate tenant update failed', updateError as Error, {
        userId: user.id,
        tenantId: existing.id,
      });
      return NextResponse.json({ error: 'Failed to save agent' }, { status: 500 });
    }
    tenantId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('tenants')
      .insert(tenantRow)
      .select('id')
      .single();
    if (insertError || !inserted) {
      logger.error(
        'onboarding_generate tenant insert failed',
        (insertError as Error) ?? new Error('no row returned'),
        { userId: user.id },
      );
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
    }
    tenantId = inserted.id;
  }

  // ── 5. Persist raw answers to onboarding_responses (audit trail) ──
  // Non-fatal: if this fails we still consider the tenant created successfully,
  // the audit trail is best-effort.
  try {
    // Clear any previous rows for this tenant (idempotent re-run).
    await supabaseAdmin.from('onboarding_responses').delete().eq('tenant_id', tenantId);

    const rows = Object.entries(answers)
      .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
      .map(([key, value]) => ({
        tenant_id: tenantId,
        step: Number(key.replace(/^q/, '')) || 0,
        question_key: key,
        answer: { value },
      }));
    if (rows.length > 0) {
      const { error: audError } = await supabaseAdmin
        .from('onboarding_responses')
        .insert(rows);
      if (audError) {
        logger.warn('onboarding_generate audit trail insert failed', {
          tenantId,
          error: audError.message,
        });
      }
    }
  } catch (err) {
    logger.warn('onboarding_generate audit trail threw', {
      tenantId,
      error: (err as Error).message,
    });
  }

  logger.info('onboarding_generate_success', {
    userId: user.id,
    tenantId,
    vertical,
    dbBusinessType,
    answerCount: Object.keys(answers).length,
    promptLength: config.systemPrompt.length,
  });

  return NextResponse.json({
    success: true,
    tenantId,
    config: {
      verticalType: config.verticalType,
      businessName: config.businessName,
      promptLength: config.systemPrompt.length,
      neverHallucinateRules: config.neverHallucinate.length,
      crisisProtocols: config.crisisProtocols.length,
      topFaqs: config.topFaqs.length,
    },
  });
}
