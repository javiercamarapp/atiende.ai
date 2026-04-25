// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/insurance-claims/[id]
//
// Permite al dueño actualizar status de un claim desde el dashboard sin
// pasar por el agente. Caso de uso: la aseguradora paga directo al
// consultorio (direct_billing) y el dueño marca como 'paid'.
//
// Audit logged via logAudit() para compliance.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['pending_submission', 'submitted', 'in_review', 'approved', 'denied', 'partial', 'paid']).optional(),
  claim_number: z.string().max(100).nullable().optional(),
  amount_paid_mxn: z.number().min(0).max(1_000_000).nullable().optional(),
  deductible_mxn: z.number().min(0).max(1_000_000).nullable().optional(),
  denial_reason: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('user_id', user.id).single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }

  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.status === 'submitted') updates.submitted_at = new Date().toISOString();
  if (parsed.data.status && ['approved', 'denied', 'partial', 'paid'].includes(parsed.data.status)) {
    updates.resolved_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('insurance_claims')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });

  // Audit log compliance
  if (parsed.data.status) {
    await logAudit({
      tenantId: tenant.id as string,
      userId: user.id,
      action: `insurance_claim_${parsed.data.status}_manual`,
      entityType: 'insurance_claim',
      entityId: id,
      details: parsed.data as Record<string, unknown>,
    }).catch((err) => console.warn('[insurance.patch] audit failed:', err instanceof Error ? err.message : err));
  }

  return NextResponse.json({ ok: true });
}
