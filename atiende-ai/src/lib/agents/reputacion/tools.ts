// ═════════════════════════════════════════════════════════════════════════════
// REPUTACION TOOLS — Phase 3.B.2
// 24h después de encuesta con rating=Excelente y would_recommend=true,
// envía link de Google Reviews al paciente.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { normalizePhoneMx } from '@/lib/whatsapp/normalize-phone';

// ─── Tool 1: send_review_request ────────────────────────────────────────────
const SendReviewArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    doctor_name: z.string().min(1).max(200),
  })
  .strict();

registerTool('send_review_request', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_review_request',
      description: 'Envía solicitud de reseña Google al paciente. Incluye el google_review_url del tenant.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          doctor_name: { type: 'string' },
        },
        required: ['patient_phone', 'patient_name', 'doctor_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendReviewArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    const reviewUrl = (ctx.tenant.google_review_url as string) || '';
    const businessName = (ctx.tenant.name as string) || 'nuestro consultorio';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };
    if (!reviewUrl) return { sent: false, error: 'no google_review_url configurado' };

    const text = [
      `Hola ${args.patient_name} 😊`,
      `Nos alegra mucho que su experiencia con ${args.doctor_name} en ${businessName} haya sido excelente.`,
      '',
      'Si tiene un momento, nos ayudaría muchísimo dejar una reseña en Google:',
      reviewUrl,
      '',
      'Solo toma 1 minuto y ayuda a otros pacientes a encontrarnos 🙏',
    ].join('\n');

    const phone = normalizePhoneMx(args.patient_phone);
    if (!phone) return { sent: false, error: 'invalid patient_phone' };
    try {
      const r = await sendTextMessageSafe(phoneNumberId, phone, text, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW' };
      }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { sent: true };
  },
});

// ─── Tool 2: track_review_sent ──────────────────────────────────────────────
const TrackArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    appointment_id: z.string().uuid(),
  })
  .strict();

registerTool('track_review_sent', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'track_review_sent',
      description: 'Marca que ya se solicitó reseña al paciente para no duplicar el envío.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          appointment_id: { type: 'string' },
        },
        required: ['patient_phone', 'appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = TrackArgs.parse(rawArgs);
    const phone = normalizePhoneMx(args.patient_phone);
    if (!phone) return { tracked: false, error: 'invalid patient_phone' };
    const { error } = await supabaseAdmin
      .from('contacts')
      .update({
        review_requested: true,
        review_requested_at: new Date().toISOString(),
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', phone);
    if (error) return { tracked: false, error: error.message };
    return { tracked: true, appointment_id: args.appointment_id };
  },
});

// ─── Tool 3: check_existing_google_review ────────────────────────────────────
// Antes de pedir reseña, el agente chequea si ya existe una reseña en
// google_reviews con el nombre del paciente. Evita pedirla dos veces.
const CheckExistingArgs = z
  .object({ patient_name: z.string().min(2).max(200) })
  .strict();

registerTool('check_existing_google_review', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'check_existing_google_review',
      description:
        'Chequea si el paciente ya dejó una reseña en Google (sincronizada de la Places API). Match fuzzy por nombre — Google no expone phone en reviews. Usar ANTES de send_review_request para no pedir doble.',
      parameters: {
        type: 'object',
        properties: { patient_name: { type: 'string' } },
        required: ['patient_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CheckExistingArgs.parse(rawArgs);
    // Normalización: lowercase + quita acentos + primer nombre
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const firstName = norm(args.patient_name).split(/\s+/)[0];
    if (!firstName || firstName.length < 2) return { exists: false };

    const { data } = await supabaseAdmin
      .from('google_reviews')
      .select('rating, posted_at, reviewer_name')
      .eq('tenant_id', ctx.tenantId)
      .ilike('reviewer_name', `%${firstName}%`)
      .order('posted_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return { exists: false };
    const row = data[0];
    return {
      exists: true,
      rating: row.rating,
      posted_at: row.posted_at,
      reviewer_name: row.reviewer_name,
    };
  },
});
