// ═════════════════════════════════════════════════════════════════════════════
// TRIAJE TOOLS — Phase 3.C
//
// Pre-consulta clínica: el bot hace 3-5 preguntas estructuradas, calcula
// nivel de urgencia (ESI 1-4), y deja registro auditable. NUNCA da
// diagnóstico ni receta — solo clasifica y deriva.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { trackError } from '@/lib/monitoring';

async function assertContact(tenantId: string, contactId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('contacts').select('id')
    .eq('id', contactId).eq('tenant_id', tenantId).maybeSingle();
  if (!data) { trackError('triage_tool_cross_tenant_blocked'); return false; }
  return true;
}

// ─── Tool: record_triage_assessment ─────────────────────────────────────────
const RecordArgs = z.object({
  urgency_level: z.number().int().min(1).max(4),
  chief_complaint: z.string().min(3).max(500),
  symptoms: z.array(z.string().min(2).max(100)).max(10).optional(),
  duration_hours: z.number().int().min(0).max(720).optional(),
  pain_scale: z.number().int().min(0).max(10).optional(),
  recommendation: z.string().min(10).max(1000),
  escalated_to_doctor: z.boolean().default(false),
  redirected_to_er: z.boolean().default(false),
}).strict();

registerTool('record_triage_assessment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'record_triage_assessment',
      description:
        'Registra una evaluación de triaje clínico. urgency_level: 1=ER inmediato (911), 2=urgente <24h (mismo día doctor), 3=esta semana, 4=no urgente (agendar normal). Llamar al final de la conversación cuando ya tenés chief_complaint y recomendación clara. SIEMPRE deja registro auditable — NOM-004.',
      parameters: {
        type: 'object',
        properties: {
          urgency_level: { type: 'number', enum: [1, 2, 3, 4], description: '1=ER, 2=urgente, 3=esta semana, 4=no urgente' },
          chief_complaint: { type: 'string', description: 'Lo que el paciente dijo en sus palabras: "dolor de muela 8/10 desde ayer"' },
          symptoms: { type: 'array', items: { type: 'string' }, description: 'Síntomas estructurados: ["fiebre 38", "inflamación encía"]' },
          duration_hours: { type: 'number', description: 'Cuántas horas lleva el síntoma' },
          pain_scale: { type: 'number', minimum: 0, maximum: 10, description: 'Escala 0-10 si aplica' },
          recommendation: { type: 'string', description: 'Lo que el bot le dijo: "Le recomiendo ir a urgencias del Hospital X" / "Voy a agendarle con el Dr. mañana"' },
          escalated_to_doctor: { type: 'boolean', description: 'true si llamaste escalate_urgency en este flow' },
          redirected_to_er: { type: 'boolean', description: 'true si le dijiste al paciente que vaya a urgencias / 911' },
        },
        required: ['urgency_level', 'chief_complaint', 'recommendation'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = RecordArgs.parse(rawArgs);
    if (!ctx.contactId) return { recorded: false, error: 'no contactId' };
    if (!(await assertContact(ctx.tenantId, ctx.contactId))) {
      return { recorded: false, error: 'contact does not belong to tenant' };
    }

    const { data, error } = await supabaseAdmin.from('triage_assessments').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId ?? null,
      urgency_level: args.urgency_level,
      chief_complaint: args.chief_complaint,
      symptoms: args.symptoms ?? null,
      duration_hours: args.duration_hours ?? null,
      pain_scale: args.pain_scale ?? null,
      recommendation: args.recommendation,
      escalated_to_doctor: args.escalated_to_doctor,
      redirected_to_er: args.redirected_to_er,
    }).select('id').single();

    if (error || !data) return { recorded: false, error: error?.message };

    // Audit fix: log triage assessment para compliance NOM-024 / NOM-004.
    // Toda decisión clínica (incluyendo "no urgente, agendar normal") debe
    // tener trail. trackError counter dispara alertas si urgency_level=1
    // (ER) supera threshold/hora — investigá outbreak local.
    try {
      const { logAudit } = await import('@/lib/audit');
      await logAudit({
        tenantId: ctx.tenantId,
        action: `triage_level_${args.urgency_level}`,
        entityType: 'triage_assessment',
        entityId: data.id,
        details: {
          chief_complaint: args.chief_complaint,
          pain_scale: args.pain_scale,
          escalated_to_doctor: args.escalated_to_doctor,
          redirected_to_er: args.redirected_to_er,
        },
      });
      if (args.urgency_level === 1) {
        const { trackError } = await import('@/lib/monitoring');
        trackError('triage_er_level_1');
      }
    } catch { /* audit is best-effort */ }

    // Si urgency_level ≤ 2 (ER o urgente <24h) y el agente NO marcó
    // escalated_to_doctor, devolvemos warning para que el LLM re-intente
    // con escalate_urgency. Defense in depth contra prompts que se olvidan
    // del paso de escalación.
    const must_escalate = args.urgency_level <= 2 && !args.escalated_to_doctor && !args.redirected_to_er;
    return {
      recorded: true,
      assessment_id: data.id,
      urgency_level: args.urgency_level,
      must_escalate,
      next_step: must_escalate
        ? 'CRÍTICO: urgency_level ≤2 sin escalación. Llamá escalate_urgency({severity: "high"}) AHORA.'
        : null,
    };
  },
});
