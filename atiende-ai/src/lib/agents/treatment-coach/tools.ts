// ═════════════════════════════════════════════════════════════════════════════
// TREATMENT COACH TOOLS — Phase 3
//
// Pacientes en tratamientos largos (orto, fisio, etc). Tools:
//   - create_treatment_plan — dueño o agente crea el plan después de una
//     consulta de diagnóstico
//   - get_patient_treatment_plan — leer plan activo del paciente
//   - mark_session_completed — al terminar cada cita la sesión avanza
//   - suggest_next_session — cadence-based, devuelve próxima fecha ideal
//   - pause_or_abandon_plan — si el paciente dice "ya no vengo más"
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { assertContactInTenant } from '@/lib/agents/shared/tenant-guards';

const assertContact = (tenantId: string, contactId: string) =>
  assertContactInTenant(tenantId, contactId, 'treatment');

// ─── Tool: create_treatment_plan ───────────────────────────────────────────
const CreatePlanArgs = z.object({
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

registerTool('create_treatment_plan', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'create_treatment_plan',
      description:
        'Crea un plan de tratamiento multi-sesión para el paciente actual. Ej: ortodoncia 20 sesiones cada 21 días, fisioterapia 15 sesiones cada 3 días. El sistema pre-genera todas las sesiones del plan con expected_date calculado por cadence_days.',
      parameters: {
        type: 'object',
        properties: {
          plan_type: { type: 'string', enum: ['orthodontics', 'physiotherapy', 'endodontics', 'implant', 'aesthetic', 'rehabilitation', 'other'] },
          plan_name: { type: 'string' },
          total_sessions: { type: 'number' },
          cadence_days: { type: 'number', description: 'Días entre sesiones. Ej: 21 para orto mensual, 3 para fisio.' },
          estimated_duration_weeks: { type: 'number' },
          total_cost_mxn: { type: 'number' },
          payment_model: { type: 'string', enum: ['per_session', 'package_upfront', 'package_installments'] },
          staff_id: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['plan_type', 'plan_name', 'total_sessions'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = CreatePlanArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const startDate = new Date();
    const targetEndDate = args.cadence_days
      ? new Date(startDate.getTime() + args.cadence_days * args.total_sessions * 86_400_000)
      : null;

    const { data: plan, error } = await supabaseAdmin.from('treatment_plans').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
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

    if (error || !plan) return { created: false, error: error?.message };

    // Pre-generar las sesiones con expected_date si tenemos cadence
    const rows = Array.from({ length: args.total_sessions }, (_, i) => {
      const sessionNum = i + 1;
      const expectedDate = args.cadence_days
        ? new Date(startDate.getTime() + args.cadence_days * i * 86_400_000).toISOString().slice(0, 10)
        : null;
      return {
        plan_id: plan.id,
        tenant_id: ctx.tenantId,
        session_number: sessionNum,
        expected_date: expectedDate,
        status: 'pending' as const,
      };
    });
    await supabaseAdmin.from('treatment_sessions').insert(rows);

    return {
      created: true,
      plan_id: plan.id,
      total_sessions: args.total_sessions,
      target_end_date: targetEndDate?.toISOString().slice(0, 10) ?? null,
    };
  },
});

// ─── Tool: get_patient_treatment_plan ──────────────────────────────────────
const GetPlanArgs = z.object({}).strict();

registerTool('get_patient_treatment_plan', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_patient_treatment_plan',
      description:
        'Devuelve el plan activo del paciente actual (si tiene). Incluye total_sessions, cuántas completadas, cuántas quedan, próxima expected_date. Invocar al inicio de cualquier conversación si el paciente podría estar en tratamiento largo.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_rawArgs, ctx) => {
    if (!ctx.contactId) return { plan: null };

    const { data: plan } = await supabaseAdmin
      .from('treatment_plans')
      .select('id, plan_type, plan_name, total_sessions, cadence_days, target_end_date, total_cost_mxn, payment_model, status, started_at, notes, staff:staff_id(name)')
      .eq('tenant_id', ctx.tenantId)
      .eq('contact_id', ctx.contactId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!plan) return { plan: null };

    const { data: sessions } = await supabaseAdmin
      .from('treatment_sessions')
      .select('session_number, expected_date, status, completed_at')
      .eq('plan_id', plan.id)
      .order('session_number');

    const completed = (sessions || []).filter((s) => s.status === 'completed').length;
    const nextPending = (sessions || []).find((s) => s.status === 'pending');
    const staff = Array.isArray(plan.staff) ? plan.staff[0] : plan.staff;

    return {
      plan: {
        id: plan.id,
        plan_type: plan.plan_type,
        plan_name: plan.plan_name,
        total_sessions: plan.total_sessions,
        completed_sessions: completed,
        remaining_sessions: (plan.total_sessions as number) - completed,
        next_expected_date: nextPending?.expected_date ?? null,
        next_session_number: nextPending?.session_number ?? null,
        target_end_date: plan.target_end_date,
        doctor_name: staff?.name,
        started_at: plan.started_at,
      },
    };
  },
});

// ─── Tool: mark_session_completed ──────────────────────────────────────────
const MarkSessionArgs = z.object({
  plan_id: z.string().uuid(),
  session_number: z.number().int().min(1),
  appointment_id: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
}).strict();

registerTool('mark_session_completed', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'mark_session_completed',
      description:
        'Marca una sesión del plan como completada. Usualmente llamado después de una cita exitosa. Si todas las sesiones están completadas, marca automáticamente el plan como status="completed".',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string' },
          session_number: { type: 'number' },
          appointment_id: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['plan_id', 'session_number'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = MarkSessionArgs.parse(rawArgs);

    const { data: session, error } = await supabaseAdmin
      .from('treatment_sessions')
      .update({
        status: 'completed',
        appointment_id: args.appointment_id ?? null,
        completion_notes: args.notes ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('plan_id', args.plan_id)
      .eq('session_number', args.session_number)
      .eq('tenant_id', ctx.tenantId)
      .select('id')
      .single();

    if (error || !session) return { marked: false, error: error?.message };

    // Si todas las sesiones están completadas, cerrar el plan
    const { data: plan } = await supabaseAdmin
      .from('treatment_plans')
      .select('total_sessions')
      .eq('id', args.plan_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (plan) {
      const { count: completedCount } = await supabaseAdmin
        .from('treatment_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', args.plan_id)
        .eq('status', 'completed');

      if ((completedCount ?? 0) >= (plan.total_sessions as number)) {
        await supabaseAdmin
          .from('treatment_plans')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', args.plan_id);
        return { marked: true, plan_completed: true };
      }
    }

    return { marked: true, plan_completed: false };
  },
});

// ─── Tool: pause_or_abandon_plan ───────────────────────────────────────────
const PausePlanArgs = z.object({
  plan_id: z.string().uuid(),
  action: z.enum(['pause', 'abandon', 'resume', 'cancel']),
  reason: z.string().max(500).optional(),
}).strict();

registerTool('pause_or_abandon_plan', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'pause_or_abandon_plan',
      description:
        'Pausa, abandona, reanuda o cancela un plan activo. "pause" = paciente temporalmente no puede, volverá. "abandon" = dropout (paciente no sigue). "resume" = pasar de paused→active. "cancel" = descartar el plan.',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string' },
          action: { type: 'string', enum: ['pause', 'abandon', 'resume', 'cancel'] },
          reason: { type: 'string' },
        },
        required: ['plan_id', 'action'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = PausePlanArgs.parse(rawArgs);
    const updates: Record<string, unknown> = {};
    if (args.action === 'pause') updates.status = 'paused';
    if (args.action === 'resume') updates.status = 'active';
    if (args.action === 'abandon') { updates.status = 'abandoned'; updates.abandoned_at = new Date().toISOString(); }
    if (args.action === 'cancel') updates.status = 'cancelled';
    if (args.reason) updates.notes = args.reason;

    const { error } = await supabaseAdmin
      .from('treatment_plans')
      .update(updates)
      .eq('id', args.plan_id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { updated: false, error: error.message };
    return { updated: true, new_status: updates.status };
  },
});
