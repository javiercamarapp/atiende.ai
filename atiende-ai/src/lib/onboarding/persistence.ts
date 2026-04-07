// Onboarding persistence layer.
//
// Every answer the user gives gets saved to `onboarding_responses` as it
// arrives, and uploaded documents get indexed as `knowledge_chunks` under
// the tenant. The 43-vertical enum doesn't match the legacy `business_type`
// ENUM in the DB, so the new-style vertical is stored in `tenants.config`
// under the `vertical` key. `business_type` falls back to `'other'` when
// there's no direct mapping.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { VERTICAL_NAMES } from '@/lib/verticals';
import type { VerticalEnum } from '@/lib/verticals/types';
import { logger } from '@/lib/logger';

// Subset of the legacy `business_type` ENUM. Values we KNOW are valid.
// Everything else falls back to 'other'.
const LEGACY_TYPE_MAP: Partial<Record<VerticalEnum, string>> = {
  dental: 'dental',
  medico: 'medical',
  dermatologo: 'dermatologist',
  psicologo: 'psychologist',
  nutriologa: 'nutritionist',
  ginecologo: 'gynecologist',
  pediatra: 'pediatrician',
  oftalmologo: 'ophthalmologist',
  veterinaria: 'veterinary',
  farmacia: 'pharmacy',
  restaurante: 'restaurant',
  taqueria: 'taqueria',
  cafeteria: 'cafe',
  hotel: 'hotel',
  hotel_boutique: 'hotel',
  salon_belleza: 'salon',
  barberia: 'barbershop',
  spa: 'spa',
  gimnasio: 'gym',
  escuela: 'school',
  seguros: 'insurance',
  taller_mecanico: 'mechanic',
  contable_legal: 'accountant',
  floreria: 'florist',
};

function toLegacyBusinessType(vertical: VerticalEnum): string {
  return LEGACY_TYPE_MAP[vertical] || 'other';
}

export interface OnboardingState {
  tenantId: string | null;
  vertical: VerticalEnum | null;
  businessName: string;
  answers: Record<string, string>;
}

export async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch (err) {
    logger.error(
      'getAuthUserId failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}

/**
 * Get the existing tenant for a user, or create a minimal one.
 * Returns the tenant_id.
 */
export async function ensureTenant(
  userId: string,
  opts: { vertical?: VerticalEnum; businessName?: string } = {},
): Promise<string> {
  // Look for existing tenant
  const { data: existing, error: selectErr } = await supabaseAdmin
    .from('tenants')
    .select('id, name, config, business_type')
    .eq('user_id', userId)
    .maybeSingle();

  if (selectErr) {
    logger.error('ensureTenant select failed', new Error(selectErr.message), { userId });
  }

  if (existing) {
    // Patch name / config if new info was provided
    const patch: Record<string, unknown> = {};
    if (opts.businessName && opts.businessName.trim()) {
      patch.name = opts.businessName.trim();
    }
    if (opts.vertical) {
      const existingConfig = (existing.config as Record<string, unknown> | null) ?? {};
      patch.config = { ...existingConfig, vertical: opts.vertical };
      patch.business_type = toLegacyBusinessType(opts.vertical);
    }
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error: updateErr } = await supabaseAdmin
        .from('tenants')
        .update(patch)
        .eq('id', existing.id)
        .eq('user_id', userId); // defense-in-depth: scope by user too
      if (updateErr) {
        logger.error('ensureTenant update failed', new Error(updateErr.message), {
          userId,
          tenantId: existing.id,
        });
      }
    }
    return existing.id;
  }

  // Create a new tenant row
  const name = opts.businessName?.trim() || (opts.vertical ? VERTICAL_NAMES[opts.vertical] : 'Nuevo negocio');
  const businessType = opts.vertical ? toLegacyBusinessType(opts.vertical) : 'other';
  const config = opts.vertical ? { vertical: opts.vertical } : {};

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('tenants')
    .insert({
      user_id: userId,
      name,
      business_type: businessType,
      status: 'onboarding',
      config,
    })
    .select('id')
    .single();

  if (insertErr || !created) {
    const err = insertErr ? new Error(insertErr.message) : new Error('tenant insert returned null');
    logger.error('ensureTenant insert failed', err, { userId });
    throw err;
  }

  return created.id;
}

/**
 * Upsert onboarding answers for a tenant. Each key in `answers` becomes a
 * row in `onboarding_responses`. Existing rows for the same question_key
 * are replaced (we delete + insert rather than ON CONFLICT because
 * onboarding_responses doesn't have a unique index).
 */
export async function saveAnswers(
  tenantId: string,
  answers: Record<string, string>,
): Promise<void> {
  const keys = Object.keys(answers).filter((k) => answers[k] && answers[k].trim());
  if (keys.length === 0) return;

  // Delete existing rows for these keys so we always have the latest value
  const { error: deleteErr } = await supabaseAdmin
    .from('onboarding_responses')
    .delete()
    .eq('tenant_id', tenantId)
    .in('question_key', keys);

  if (deleteErr) {
    logger.error('saveAnswers delete failed', new Error(deleteErr.message), { tenantId });
  }

  const rows = keys.map((key) => {
    const step = parseInt(key.replace(/\D/g, ''), 10) || 0;
    return {
      tenant_id: tenantId,
      step,
      question_key: key,
      answer: { value: answers[key] },
    };
  });

  const { error: insertErr } = await supabaseAdmin
    .from('onboarding_responses')
    .insert(rows);

  if (insertErr) {
    logger.error('saveAnswers insert failed', new Error(insertErr.message), {
      tenantId,
      rowCount: rows.length,
    });
  }
}

/**
 * Save extracted PDF/image content as a knowledge chunk for RAG.
 * The embedding is left NULL — a background job (or the RAG layer) will
 * fill it on first query.
 */
export async function saveKnowledgeChunk(
  tenantId: string,
  content: string,
  category: string = 'onboarding_upload',
  sourceName?: string,
): Promise<void> {
  if (!content || content.trim().length === 0) return;

  const source = sourceName ? `onboarding_upload:${sourceName}` : 'onboarding_upload';

  const { error } = await supabaseAdmin.from('knowledge_chunks').insert({
    tenant_id: tenantId,
    content: content.trim(),
    category,
    source,
  });

  if (error) {
    logger.error('saveKnowledgeChunk insert failed', new Error(error.message), {
      tenantId,
      category,
      contentLength: content.length,
    });
  }
}

/**
 * Load the saved onboarding state for a user — used to resume an
 * interrupted onboarding on page refresh.
 */
export async function loadOnboardingState(userId: string): Promise<OnboardingState> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, config')
    .eq('user_id', userId)
    .maybeSingle();

  if (!tenant) {
    return { tenantId: null, vertical: null, businessName: '', answers: {} };
  }

  const config = (tenant.config as Record<string, unknown> | null) ?? {};
  const vertical = (config.vertical as VerticalEnum | undefined) ?? null;

  const { data: responses } = await supabaseAdmin
    .from('onboarding_responses')
    .select('question_key, answer')
    .eq('tenant_id', tenant.id);

  const answers: Record<string, string> = {};
  for (const row of responses ?? []) {
    const answerVal = (row.answer as { value?: string } | null)?.value;
    if (typeof answerVal === 'string') {
      answers[row.question_key as string] = answerVal;
    }
  }

  return {
    tenantId: tenant.id,
    vertical,
    businessName: tenant.name as string,
    answers,
  };
}
