// ═════════════════════════════════════════════════════════════════════════════
// AGENDA-GAP TOOLS — Phase 3.B.2
// Detecta huecos en la agenda del día y propone llenarlos con pacientes
// elegibles (próxima visita predicha cerca, o churn medio).
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool 1: detect_schedule_gaps ───────────────────────────────────────────
const DetectGapsArgs = z
  .object({
    tenant_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    min_gap_minutes: z.number().int().min(15).max(240).optional().default(60),
  })
  .strict();

interface Gap {
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

registerTool('detect_schedule_gaps', {
  schema: {
    type: 'function',
    function: {
      name: 'detect_schedule_gaps',
      description: 'Calcula huecos sin citas en la agenda del día (>= min_gap_minutes).',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          min_gap_minutes: { type: 'number', description: 'Default 60' },
        },
        required: ['tenant_id', 'date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = DetectGapsArgs.parse(rawArgs);
    if (args.tenant_id !== ctx.tenantId) {
      return { success: false, error_code: 'TENANT_MISMATCH', gaps: [] };
    }

    // Ventana del día en TZ tenant
    const dayStart = new Date(`${args.date}T00:00:00Z`).toISOString();
    const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60_000).toISOString();

    const { data: appts } = await supabaseAdmin
      .from('appointments')
      .select('datetime, end_datetime')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('datetime', dayStart)
      .lt('datetime', dayEnd)
      .order('datetime', { ascending: true });

    // Business hours del día (asumimos lun-vie 9-18 si no hay config)
    const hours = (ctx.tenant.business_hours as Record<string, string>) || {};
    const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
    const dayKey = days[new Date(args.date + 'T12:00:00Z').getDay()];
    const window = hours[dayKey] || '09:00-18:00';
    if (window === 'cerrado') return { success: true, gaps: [] };

    const [openH, closeH] = window.split('-');
    const openMs = new Date(`${args.date}T${openH}:00`).getTime();
    const closeMs = new Date(`${args.date}T${closeH}:00`).getTime();

    const gaps: Gap[] = [];
    let cursor = openMs;
    const minGapMs = (args.min_gap_minutes ?? 60) * 60_000;

    for (const a of appts || []) {
      const aptStart = new Date(a.datetime as string).getTime();
      const aptEnd = a.end_datetime
        ? new Date(a.end_datetime as string).getTime()
        : aptStart + 30 * 60_000;
      if (aptStart - cursor >= minGapMs) {
        gaps.push({
          start_time: new Date(cursor).toISOString().slice(11, 16),
          end_time: new Date(aptStart).toISOString().slice(11, 16),
          duration_minutes: Math.round((aptStart - cursor) / 60_000),
        });
      }
      cursor = Math.max(cursor, aptEnd);
    }
    if (closeMs - cursor >= minGapMs) {
      gaps.push({
        start_time: new Date(cursor).toISOString().slice(11, 16),
        end_time: new Date(closeMs).toISOString().slice(11, 16),
        duration_minutes: Math.round((closeMs - cursor) / 60_000),
      });
    }

    return { success: true, date: args.date, gaps, count: gaps.length };
  },
});

// ─── Tool 2: get_candidates_for_gaps ────────────────────────────────────────
const GetCandidatesArgs = z
  .object({
    tenant_id: z.string().uuid(),
    available_slots: z.array(
      z.object({
        start_time: z.string(),
        end_time: z.string(),
        duration_minutes: z.number(),
      }),
    ),
    limit: z.number().int().min(1).max(20).optional().default(5),
  })
  .strict();

registerTool('get_candidates_for_gaps', {
  schema: {
    type: 'function',
    function: {
      name: 'get_candidates_for_gaps',
      description: 'Lista pacientes que podrían llenar los huecos: predicted_visit cerca, o churn medio. Ordenados por LTV.',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string' },
          available_slots: { type: 'array' },
          limit: { type: 'number' },
        },
        required: ['tenant_id', 'available_slots'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetCandidatesArgs.parse(rawArgs);
    if (args.tenant_id !== ctx.tenantId) return { success: false, error_code: 'TENANT_MISMATCH' };

    const futureCutoff = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id, phone, name, churn_probability, lifetime_value_mxn, next_visit_predicted_at')
      .eq('tenant_id', ctx.tenantId)
      .or(`next_visit_predicted_at.lt.${futureCutoff},churn_probability.gt.50`)
      .order('lifetime_value_mxn', { ascending: false })
      .limit(args.limit ?? 5);

    if (error) return { success: false, error: error.message, candidates: [] };
    return {
      success: true,
      count: (data || []).length,
      candidates: (data || []).map((c) => ({
        contact_id: c.id as string,
        patient_phone: c.phone as string,
        patient_name: (c.name as string) || 'paciente',
        ltv_mxn: Number(c.lifetime_value_mxn ?? 0),
      })),
    };
  },
});

// ─── Tool 3: send_gap_fill_message ──────────────────────────────────────────
const SendGapArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    available_slots: z.array(z.string()).min(1).max(5),
    last_service: z.string().optional(),
  })
  .strict();

registerTool('send_gap_fill_message', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_gap_fill_message',
      description: 'Mensaje proactivo ofreciendo slots disponibles hoy a un paciente elegible.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          available_slots: { type: 'array', items: { type: 'string' } },
          last_service: { type: 'string' },
        },
        required: ['patient_phone', 'patient_name', 'available_slots'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendGapArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    const slotList = args.available_slots.slice(0, 3).join(' o ');
    const text = `Hola ${args.patient_name}, hoy tenemos disponibilidad para ${args.last_service || 'su próxima consulta'} a las ${slotList}. Si le interesa, responda *AGENDA* y le confirmamos 📅`;

    try {
      // FIX 3 (audit Round 2): valida ventana 24h
      const r = await sendTextMessageSafe(phoneNumberId, args.patient_phone, text, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW' };
      }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true };
  },
});
