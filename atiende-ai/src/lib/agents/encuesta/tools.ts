// ═════════════════════════════════════════════════════════════════════════════
// ENCUESTA TOOLS — Phase 3.B
// Agente que envía encuesta de satisfacción 2h después de cada cita completada.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendTextMessageSafe } from '@/lib/whatsapp/send';
void sendTextMessage;
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { normalizePhoneMx } from '@/lib/whatsapp/normalize-phone';

// ─── Tool 1: send_satisfaction_survey ────────────────────────────────────────
const SendSurveyArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    patient_name: z.string().min(1).max(200),
    doctor_name: z.string().min(1).max(200),
  })
  .strict();

registerTool('send_satisfaction_survey', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_satisfaction_survey',
      description: 'Envía 3 preguntas de encuesta de satisfacción por WhatsApp (calificación + recomendación + comentario abierto).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          doctor_name: { type: 'string' },
        },
        required: ['appointment_id', 'patient_phone', 'patient_name', 'doctor_name'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendSurveyArgs.parse(rawArgs);
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (!phoneNumberId) return { sent: false, error: 'no wa_phone_number_id' };

    // Normalizar el phone del paciente antes de enviar — el LLM puede
    // pasar formatos variados (+52, 52, 521, con/sin guiones).
    const targetPhone = normalizePhoneMx(args.patient_phone);
    if (!targetPhone) return { sent: false, error: 'invalid patient_phone' };

    const text = [
      `Hola ${args.patient_name}, esperamos que su cita con ${args.doctor_name} haya sido de su agrado 😊`,
      '',
      '¿Nos podría compartir su opinión?',
      '',
      '1️⃣ ¿Cómo califica su atención? (Excelente / Buena / Regular / Mala)',
      '2️⃣ ¿Recomendaría nuestro consultorio? (Sí / No / Tal vez)',
      '3️⃣ ¿Tiene algún comentario o duda sobre su tratamiento?',
    ].join('\n');

    // FIX P0: enviar primero, marcar state SOLO si el send fue exitoso.
    // Antes el state se ponía siempre — si el send fallaba (windowExpired,
    // network error), la conversación quedaba marcada AWAITING_SURVEY_RESPONSE
    // sin que el paciente hubiera recibido la encuesta → cualquier mensaje
    // suyo se ruteaba al agente encuesta equivocado.
    let sendOk = false;
    try {
      const r = await sendTextMessageSafe(phoneNumberId, targetPhone, text, { tenantId: ctx.tenantId });
      if (!r.ok && r.windowExpired) {
        return { sent: false, error: 'OUTSIDE_24H_WINDOW' };
      }
      sendOk = r.ok;
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!sendOk) {
      return { sent: false, error: 'SEND_FAILED' };
    }

    // Solo si el send fue OK marcamos AWAITING_SURVEY_RESPONSE.
    if (ctx.conversationId) {
      try {
        const { setConversationState, ConversationStateEnum } = await import('@/lib/actions/state-machine');
        await setConversationState(ctx.conversationId, ConversationStateEnum.AWAITING_SURVEY_RESPONSE, {
          appointment_id: args.appointment_id,
          doctor_name: args.doctor_name,
        });
      } catch {
        /* best effort — el state es nice-to-have */
      }
    }
    return { sent: true, appointment_id: args.appointment_id };
  },
});

// ─── Tool 2: save_survey_response ────────────────────────────────────────────
const SaveSurveyArgs = z
  .object({
    appointment_id: z.string().uuid(),
    patient_phone: z.string().min(6).max(20),
    rating: z.enum(['Excelente', 'Buena', 'Regular', 'Mala']),
    would_recommend: z.boolean(),
    comment: z.string().max(2000).optional(),
    sentiment_score: z.number().min(-1).max(1).optional(),
  })
  .strict();

registerTool('save_survey_response', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'save_survey_response',
      description: 'Persiste la respuesta de la encuesta. Si rating=Mala o sentiment_score<-0.5, notifica al doctor inmediatamente. Si rating=Excelente y would_recommend=true, encola activación de REPUTACIÓN en 24h.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          rating: { type: 'string', enum: ['Excelente', 'Buena', 'Regular', 'Mala'] },
          would_recommend: { type: 'boolean' },
          comment: { type: 'string' },
          sentiment_score: { type: 'number', minimum: -1, maximum: 1 },
        },
        required: ['appointment_id', 'patient_phone', 'rating', 'would_recommend'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SaveSurveyArgs.parse(rawArgs);
    // Normalizar el phone para que la query a contacts matchee aunque el
    // LLM lo pase con +52 / 52 / con guiones / etc.
    const phone = normalizePhoneMx(args.patient_phone);
    if (!phone) return { saved: false, error: 'invalid patient_phone' };

    const { error } = await supabaseAdmin.from('survey_responses').insert({
      tenant_id: ctx.tenantId,
      appointment_id: args.appointment_id,
      patient_phone: phone,
      rating: args.rating,
      would_recommend: args.would_recommend,
      comment: args.comment ?? null,
      sentiment_score: args.sentiment_score ?? null,
    });
    if (error) return { saved: false, error: error.message };

    // Update last_satisfaction_rating en contacts
    await supabaseAdmin
      .from('contacts')
      .update({ last_satisfaction_rating: args.rating })
      .eq('tenant_id', ctx.tenantId)
      .eq('phone', phone);

    // Si insatisfecho: notificar al doctor de inmediato
    const isUnhappy =
      args.rating === 'Mala' || (args.sentiment_score !== undefined && args.sentiment_score < -0.5);
    if (isUnhappy) {
      try {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        await notifyOwner({
          tenantId: ctx.tenantId,
          event: 'complaint',
          details: `⚠️ Paciente insatisfecho: ${phone.slice(0, 6)}***\nRating: ${args.rating}\n${args.comment ? `Comentario: ${args.comment}` : ''}`,
        });
      } catch {
        /* best effort */
      }
    }

    // Si excelente + recomienda: encolar activación de REPUTACIÓN en 24h
    let reputation_scheduled = false;
    if (args.rating === 'Excelente' && args.would_recommend) {
      const sendAt = new Date(Date.now() + 24 * 60 * 60_000);
      await supabaseAdmin.from('scheduled_messages').insert({
        tenant_id: ctx.tenantId,
        patient_phone: phone,
        message_type: 'follow_up',
        message_content: '__REPUTACION_TRIGGER__',
        scheduled_at: sendAt.toISOString(),
        metadata: { trigger: 'reputation_request', appointment_id: args.appointment_id },
      });
      reputation_scheduled = true;
    }

    // Cerramos el state AWAITING_SURVEY_RESPONSE — el próximo mensaje del
    // paciente ya no debe ir al agente encuesta sino al default (agenda).
    if (ctx.conversationId) {
      try {
        const { clearConversationState } = await import('@/lib/actions/state-machine');
        await clearConversationState(ctx.conversationId);
      } catch {
        /* best effort */
      }
    }

    return { saved: true, escalated: isUnhappy, reputation_scheduled };
  },
});

// ─── Tool 3: analyze_survey_sentiment ────────────────────────────────────────
const AnalyzeSentimentArgs = z.object({ comment: z.string().min(1).max(2000) }).strict();

registerTool('analyze_survey_sentiment', {
  schema: {
    type: 'function',
    function: {
      name: 'analyze_survey_sentiment',
      description: 'Clasifica sentimiento del comentario libre del paciente y retorna score -1..+1.',
      parameters: {
        type: 'object',
        properties: { comment: { type: 'string' } },
        required: ['comment'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown) => {
    const args = AnalyzeSentimentArgs.parse(rawArgs);
    try {
      const result = await generateResponse({
        model: MODELS.ORCHESTRATOR_FALLBACK, // gpt-4.1-mini
        system:
          'Eres un clasificador de sentimiento. Recibes un comentario en español y respondes UN SOLO número decimal entre -1 (muy negativo) y 1 (muy positivo). Sin texto adicional.',
        messages: [{ role: 'user', content: args.comment }],
        temperature: 0,
        maxTokens: 10,
      });
      const score = Number.parseFloat(result.text.trim());
      if (Number.isNaN(score)) return { sentiment_score: 0, model_used: result.model };
      return {
        sentiment_score: Math.max(-1, Math.min(1, score)),
        model_used: result.model,
      };
    } catch (err) {
      return { sentiment_score: 0, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
