// ═════════════════════════════════════════════════════════════════════════════
// POST /api/treatment-plans
//
// Endpoint para crear plan de tratamiento desde el dashboard sin pasar por
// el agente (caso: doctor termina consulta, va al expediente del paciente,
// arma el plan en 1 minuto).
//
// Pre-genera las sesiones del plan con expected_date calculado por
// cadence_days — misma lógica que el tool create_treatment_plan del agente.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  contact_id: z.string().uuid(),
  plan_type: z.enum(['orthodontics', 'physiotherapy', 'endodontics', 'implant', 'aesthetic', 'rehabilitation', 'other']),
  plan_name: z.string().min(2).max(200),
  total_sessions: z.number().int().min(2).max(200),
  cadence_days: z.number().int().min(1).max(365).optional(),
  estimated_duration_weeks: z.number().int().min(1).max(104).optional(),
  total_cost_mxn: z.number().min(0).optional(),
  payment_model: z.enum(['per_session', 'package_upfront', 'package_installments']).default('per_session'),
  staff_id: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
}).strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const args = parsed.data;

  // Defense in depth: contact debe pertenecer al tenant
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', args.contact_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json({ error: 'contact_not_in_tenant' }, { status: 403 });
  }

  const startDate = new Date();
  const targetEndDate = args.cadence_days
    ? new Date(startDate.getTime() + args.cadence_days * args.total_sessions * 86_400_000)
    : null;

  const { data: plan, error } = await supabaseAdmin.from('treatment_plans').insert({
    tenant_id: tenant.id,
    contact_id: args.contact_id,
    staff_id: args.staff_id ?? null,
    plan_type: args.plan_type,
    plan_name: args.plan_name,
    total_sessions: args.total_sessions,
    cadence_days: args.cadence_days ?? null,
    estimated_duration_weeks: args.estimated_duration_weeks ?? null,
    target_end_date: targetEndDate?.toISOString().slice(0, 10) ?? null,
    total_cost_mxn: args.total_cost_mxn ?? null,
    payment_model: args.payment_model,
    notes: args.notes ?? null,
  }).select('id').single();

  if (error || !plan) {
    return NextResponse.json({ error: 'create_failed', detail: error?.message }, { status: 500 });
  }

  // Pre-generar las sesiones (misma lógica que tool del agente)
  const rows = Array.from({ length: args.total_sessions }, (_, i) => ({
    plan_id: plan.id,
    tenant_id: tenant.id,
    session_number: i + 1,
    expected_date: args.cadence_days
      ? new Date(startDate.getTime() + args.cadence_days * i * 86_400_000).toISOString().slice(0, 10)
      : null,
    status: 'pending' as const,
  }));
  await supabaseAdmin.from('treatment_sessions').insert(rows);

  await logAudit({
    tenantId: tenant.id as string,
    userId: user.id,
    action: 'treatment_plan_created_manual',
    entityType: 'treatment_plan',
    entityId: plan.id as string,
    details: { plan_type: args.plan_type, total_sessions: args.total_sessions },
  }).catch((err) => console.warn('[treatment-plans.post] audit failed:', err instanceof Error ? err.message : err));

  return NextResponse.json({
    ok: true,
    plan_id: plan.id,
    total_sessions: args.total_sessions,
    target_end_date: targetEndDate?.toISOString().slice(0, 10) ?? null,
  });
}
