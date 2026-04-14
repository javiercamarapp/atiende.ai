// ═════════════════════════════════════════════════════════════════════════════
// CONVERSATION ANALYSIS — Intelligence P1
//
// 4 funciones LLM que corren en batch (cron /api/cron/intelligence):
//   1. classifyCancellationReason   — clasifica motivo de cancelación de cita
//   2. generateConversationSummary  — resumen 2-3 líneas por conversación
//   3. detectUnsatisfiedPatient     — detecta frustración → notifyOwner
//   4. generateWeeklyDigestData     — agregados para weekly-digest cron
//
// Todas son best-effort: si el LLM falla, devuelven un default no destructivo.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, generateStructured, MODELS } from '@/lib/llm/openrouter';

// ─────────────────────────────────────────────────────────────────────────────
// 1. classifyCancellationReason
// ─────────────────────────────────────────────────────────────────────────────

export const CANCELLATION_REASONS = [
  'economica',
  'tiempo',
  'olvido',
  'malestar',
  'insatisfaccion',
  'emergencia',
  'sin_razon',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

const CancellationSchema = z.object({
  reason: z.enum(CANCELLATION_REASONS),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

/**
 * Lee los últimos 5 mensajes de la conversación antes de la cancelación y
 * clasifica el motivo con GPT-4.1 mini. Persiste en
 * `appointments.cancellation_reason`.
 *
 * Best-effort: si falla, devuelve 'sin_razon' y NO actualiza el appointment.
 */
export async function classifyCancellationReason(
  conversationId: string,
  appointmentId: string,
): Promise<{ reason: CancellationReason; confidence: number; evidence: string }> {
  const defaultResult = {
    reason: 'sin_razon' as CancellationReason,
    confidence: 0,
    evidence: 'classification_skipped',
  };

  try {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!msgs || msgs.length === 0) return defaultResult;

    const transcript = [...msgs]
      .reverse()
      .map((m) => `[${m.direction}] ${(m.content as string) || ''}`)
      .join('\n');

    const r = await generateStructured({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Eres un auditor. Recibes los últimos mensajes previos a la cancelación de una cita en una clínica mexicana. Clasifica la causa según el enum. Responde JSON: {reason, confidence (0-1), evidence (cita textual del mensaje clave)}. Categorías: economica (precio/dinero), tiempo (agenda/horarios), olvido (no recuerda/se le pasó), malestar (síntomas/enfermedad), insatisfaccion (queja/molestia con servicio), emergencia (situación grave), sin_razon (no se infiere causa clara).',
      messages: [{ role: 'user', content: transcript }],
      schema: CancellationSchema,
      jsonSchemaName: 'CancellationReason',
      temperature: 0,
      maxTokens: 200,
    });

    await supabaseAdmin
      .from('appointments')
      .update({ cancellation_reason: r.data.reason })
      .eq('id', appointmentId);

    return r.data;
  } catch (err) {
    console.warn('[conversation-analysis] classifyCancellationReason failed:', err);
    return defaultResult;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. generateConversationSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un resumen 2-3 líneas en español mexicano de la conversación completa
 * y lo persiste en `conversations.summary`.
 *
 * Disparado por el cron intelligence para conversaciones con >2h sin actividad.
 */
export async function generateConversationSummary(
  conversationId: string,
): Promise<string | null> {
  try {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (!msgs || msgs.length < 2) return null;

    const transcript = msgs
      .map((m) => `[${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}] ${(m.content as string) || ''}`)
      .join('\n');

    const r = await generateResponse({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Resume esta conversación de WhatsApp en 2-3 líneas en español mexicano neutro. Menciona: qué pidió el cliente, qué se resolvió y si quedó pendiente algo. Sin emojis, sin formato markdown.',
      messages: [{ role: 'user', content: transcript }],
      temperature: 0.2,
      maxTokens: 180,
    });

    const summary = r.text.trim();
    if (summary.length === 0) return null;

    await supabaseAdmin
      .from('conversations')
      .update({ summary })
      .eq('id', conversationId);

    return summary;
  } catch (err) {
    console.warn('[conversation-analysis] generateConversationSummary failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. detectUnsatisfiedPatient
// ─────────────────────────────────────────────────────────────────────────────

const UnsatisfiedSchema = z.object({
  unsatisfied: z.boolean(),
  reason: z.string(),
  urgency: z.enum(['high', 'medium', 'low']),
});

export interface UnsatisfiedResult {
  unsatisfied: boolean;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

/**
 * Analiza una conversación activa y detecta señales de frustración:
 * mensajes repetidos del cliente, tono cortante, tiempos de espera largos.
 * Si `unsatisfied=true` y urgencia es high/medium, notifica al owner.
 */
export async function detectUnsatisfiedPatient(
  conversationId: string,
): Promise<UnsatisfiedResult> {
  const defaultResult: UnsatisfiedResult = {
    unsatisfied: false,
    reason: '',
    urgency: 'low',
  };

  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('tenant_id, customer_phone, customer_name')
      .eq('id', conversationId)
      .single();
    if (!conv) return defaultResult;

    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (!msgs || msgs.length < 3) return defaultResult;

    const transcript = [...msgs]
      .reverse()
      .map((m) => `[${m.direction}] ${(m.content as string) || ''}`)
      .join('\n');

    const r = await generateStructured({
      model: MODELS.ORCHESTRATOR_FALLBACK,
      system:
        'Eres un auditor de calidad. Analiza la conversación y decide si el paciente está insatisfecho/frustrado. Señales: repite la misma pregunta, tono cortante ("ya dije eso", "lo que sea"), esperas largas sin respuesta útil, quejas directas. Responde JSON: {unsatisfied: boolean, reason: string corto, urgency: "high"|"medium"|"low"}. High = amenaza con irse o ya tiene queja; medium = tono negativo; low = solo esperas o dudas normales.',
      messages: [{ role: 'user', content: transcript }],
      schema: UnsatisfiedSchema,
      jsonSchemaName: 'UnsatisfiedVerdict',
      temperature: 0,
      maxTokens: 200,
    });

    if (r.data.unsatisfied && r.data.urgency !== 'low') {
      try {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        await notifyOwner({
          tenantId: conv.tenant_id as string,
          event: 'complaint',
          details: `⚠️ Paciente insatisfecho (${r.data.urgency}):\n${conv.customer_name || conv.customer_phone}\n${r.data.reason}`,
        });
      } catch {
        /* best effort */
      }
    }

    return r.data;
  } catch (err) {
    console.warn('[conversation-analysis] detectUnsatisfiedPatient failed:', err);
    return defaultResult;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. generateWeeklyDigestData
// ─────────────────────────────────────────────────────────────────────────────

export interface WeeklyDigestData {
  tenant_id: string;
  week_start: string;
  week_end: string;
  appointments: {
    total: number;
    completed: number;
    no_show: number;
    cancelled: number;
  };
  revenue_mxn: number;
  new_patients: number;
  top_churn_risk: Array<{
    contact_id: string;
    name: string | null;
    phone: string;
    churn_probability: number;
    days_since_last_visit: number | null;
  }>;
}

/**
 * Agrega datos operativos de la semana para el weekly-digest cron.
 * No llama LLM — es puro SQL aggregation. El LLM se usa después (en el
 * weekly-digest cron) para convertir esto en texto ejecutivo.
 */
export async function generateWeeklyDigestData(opts: {
  tenantId: string;
  weekStart: string; // ISO
  weekEnd: string;   // ISO
}): Promise<WeeklyDigestData> {
  const { tenantId, weekStart, weekEnd } = opts;

  const [apts, newPatients, churnRisk] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('status, price_mxn')
      .eq('tenant_id', tenantId)
      .gte('datetime', weekStart)
      .lt('datetime', weekEnd),
    supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', weekStart)
      .lt('created_at', weekEnd),
    supabaseAdmin
      .from('contacts')
      .select('id, name, phone, churn_probability, next_visit_predicted_at')
      .eq('tenant_id', tenantId)
      .gt('churn_probability', 60)
      .order('churn_probability', { ascending: false })
      .limit(3),
  ]);

  const aptRows = (apts.data as Array<{ status: string; price_mxn: number | null }>) || [];
  const completed = aptRows.filter((a) => a.status === 'completed');

  return {
    tenant_id: tenantId,
    week_start: weekStart,
    week_end: weekEnd,
    appointments: {
      total: aptRows.length,
      completed: completed.length,
      no_show: aptRows.filter((a) => a.status === 'no_show').length,
      cancelled: aptRows.filter((a) => a.status === 'cancelled').length,
    },
    revenue_mxn: completed.reduce((s, a) => s + (Number(a.price_mxn) || 0), 0),
    new_patients: newPatients.count ?? 0,
    top_churn_risk: await enrichChurnRisk(tenantId, (churnRisk.data as Array<Record<string, unknown>>) || []),
  };
}

async function enrichChurnRisk(
  tenantId: string,
  rows: Array<Record<string, unknown>>,
): Promise<WeeklyDigestData['top_churn_risk']> {
  if (rows.length === 0) return [];
  const out: WeeklyDigestData['top_churn_risk'] = [];
  for (const r of rows) {
    const phone = (r.phone as string) || '';
    // Última visita completada → days_since_last_visit
    const { data: lastVisit } = await supabaseAdmin
      .from('appointments')
      .select('datetime')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', phone)
      .eq('status', 'completed')
      .order('datetime', { ascending: false })
      .limit(1)
      .maybeSingle();
    const days = lastVisit
      ? Math.floor((Date.now() - new Date(lastVisit.datetime as string).getTime()) / 86_400_000)
      : null;
    out.push({
      contact_id: r.id as string,
      name: (r.name as string | null) ?? null,
      phone,
      churn_probability: Number(r.churn_probability) || 0,
      days_since_last_visit: days,
    });
  }
  return out;
}
