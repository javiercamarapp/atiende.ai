// ═════════════════════════════════════════════════════════════════════════════
// INSURANCE CLAIMS TOOLS (Phase 3)
//
// Herramientas para el agente payment-resolution. Permiten al paciente
// trackear sus reclamos con aseguradora y al consultorio seguir direct-billing.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { assertContactInTenant } from '@/lib/agents/shared/tenant-guards';

const assertContact = (tenantId: string, contactId: string) =>
  assertContactInTenant(tenantId, contactId, 'insurance');

const INSURERS = ['GNP', 'AXA', 'Metlife', 'BUPA', 'Seguros Monterrey', 'IMSS', 'ISSSTE', 'Pemex', 'SEDENA', 'otro'] as const;

// ─── Tool: log_insurance_claim ──────────────────────────────────────────────
const LogClaimArgs = z.object({
  appointment_id: z.string().uuid().optional(),
  insurer_name: z.enum(INSURERS),
  policy_number: z.string().max(100).optional(),
  amount_claimed_mxn: z.number().min(0).max(1_000_000).optional(),
  direct_billing: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
}).strict();

registerTool('log_insurance_claim', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'log_insurance_claim',
      description:
        'Registra un reclamo a aseguradora. Usar cuando el paciente dice "necesito factura para mi seguro", "esto va por GNP", "¿me pueden facturar al seguro?", o cuando el consultorio hace direct-billing. El status inicial es pending_submission — se actualiza con update_insurance_claim_status cuando se envía a la aseguradora.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita asociada al reclamo.' },
          insurer_name: { type: 'string', enum: [...INSURERS] },
          policy_number: { type: 'string' },
          amount_claimed_mxn: { type: 'number' },
          direct_billing: { type: 'boolean', description: 'true si el consultorio cobra directo a la aseguradora; false si el paciente paga y luego pide reembolso.' },
          notes: { type: 'string' },
        },
        required: ['insurer_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = LogClaimArgs.parse(rawArgs);
    if (!ctx.contactId) return { created: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { created: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('insurance_claims').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      appointment_id: args.appointment_id ?? null,
      insurer_name: args.insurer_name,
      policy_number: args.policy_number ?? null,
      amount_claimed_mxn: args.amount_claimed_mxn ?? null,
      direct_billing: args.direct_billing,
      notes: args.notes ?? null,
      status: 'pending_submission',
    }).select('id').single();

    if (error || !data) return { created: false, error: error?.message };
    return { created: true, claim_id: data.id as string, status: 'pending_submission' };
  },
});

// ─── Tool: get_my_insurance_claims ──────────────────────────────────────────
const GetClaimsArgs = z.object({}).strict();

registerTool('get_my_insurance_claims', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_my_insurance_claims',
      description:
        'Lista los reclamos de aseguradora del paciente actual con su status. Usar cuando pregunta "¿cómo va mi reembolso?", "¿ya aprobaron mi reclamo?", "¿qué falta para mi seguro?". Retorna los reclamos ordenados por más recientes primero.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_rawArgs, ctx) => {
    if (!ctx.contactId) return { claims: [] };
    const { data } = await supabaseAdmin
      .from('insurance_claims')
      .select('id, insurer_name, policy_number, claim_number, status, amount_claimed_mxn, amount_paid_mxn, submitted_at, resolved_at, denial_reason, direct_billing')
      .eq('tenant_id', ctx.tenantId)
      .eq('contact_id', ctx.contactId)
      .order('created_at', { ascending: false })
      .limit(10);

    return {
      claims: data ?? [],
      count: (data ?? []).length,
      pending_count: (data ?? []).filter(
        (c) => !['paid', 'denied'].includes(c.status as string),
      ).length,
    };
  },
});

// ─── Tool: update_insurance_claim_status ────────────────────────────────────
const UpdateClaimArgs = z.object({
  claim_id: z.string().uuid(),
  status: z.enum(['submitted', 'in_review', 'approved', 'denied', 'partial', 'paid']),
  claim_number: z.string().max(100).optional(),
  amount_paid_mxn: z.number().min(0).max(1_000_000).optional(),
  deductible_mxn: z.number().min(0).max(1_000_000).optional(),
  denial_reason: z.string().max(500).optional(),
}).strict();

registerTool('update_insurance_claim_status', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'update_insurance_claim_status',
      description:
        'Actualiza el status de un reclamo. Flujo típico: pending_submission → submitted → in_review → approved/denied/partial → paid. Usar cuando el paciente o el dueño reportan cambios ("ya me aprobaron", "me pagaron 8500 y dejaron 1500 de deducible", "me rechazaron por falta de docs").',
      parameters: {
        type: 'object',
        properties: {
          claim_id: { type: 'string' },
          status: { type: 'string', enum: ['submitted', 'in_review', 'approved', 'denied', 'partial', 'paid'] },
          claim_number: { type: 'string', description: 'Número de siniestro emitido por la aseguradora.' },
          amount_paid_mxn: { type: 'number', description: 'Monto finalmente pagado cuando status=paid o partial.' },
          deductible_mxn: { type: 'number' },
          denial_reason: { type: 'string', description: 'Motivo si status=denied o partial.' },
        },
        required: ['claim_id', 'status'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = UpdateClaimArgs.parse(rawArgs);
    const updates: Record<string, unknown> = {
      status: args.status,
      updated_at: new Date().toISOString(),
    };
    if (args.claim_number) updates.claim_number = args.claim_number;
    if (args.amount_paid_mxn != null) updates.amount_paid_mxn = args.amount_paid_mxn;
    if (args.deductible_mxn != null) updates.deductible_mxn = args.deductible_mxn;
    if (args.denial_reason) updates.denial_reason = args.denial_reason;
    if (args.status === 'submitted') updates.submitted_at = new Date().toISOString();
    if (['approved', 'denied', 'partial', 'paid'].includes(args.status)) {
      updates.resolved_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('insurance_claims')
      .update(updates)
      .eq('id', args.claim_id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return { updated: false, error: error.message };

    // Audit fix: log clinical/financial state change para compliance.
    try {
      const { logAudit } = await import('@/lib/audit');
      await logAudit({
        tenantId: ctx.tenantId,
        action: `insurance_claim_${args.status}`,
        entityType: 'insurance_claim',
        entityId: args.claim_id,
        details: {
          new_status: args.status,
          amount_paid_mxn: args.amount_paid_mxn,
          deductible_mxn: args.deductible_mxn,
          claim_number: args.claim_number,
          denial_reason: args.denial_reason,
        },
      });
    } catch { /* audit is best-effort */ }

    return { updated: true, new_status: args.status };
  },
});
