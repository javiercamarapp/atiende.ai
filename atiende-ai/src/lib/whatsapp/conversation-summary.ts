// ═════════════════════════════════════════════════════════════════════════════
// CONVERSATION SUMMARY — memoria persistente entre 50+ mensajes
//
// Problema: historial se trunca a últimos 12 mensajes para no inflar el
// prompt. En conversaciones largas (ej. paciente que vino 20 veces), el
// LLM "olvida" lo que dijo en turnos anteriores → repite preguntas, pierde
// contexto.
//
// Solución: cada 5 turnos, llamamos a un LLM cheap (Flash-Lite) para
// generar/actualizar un resumen narrativo persistido en
// `conversations.summary`. El orquestador inyecta ese summary en el
// system prompt — sobrevive la truncación porque NO está en `messages`.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { decryptPII } from '@/lib/utils/crypto';
import { logger } from '@/lib/logger';

/** Cada cuántos mensajes outbound se re-genera el summary. */
const UPDATE_EVERY_N_MESSAGES = 5;

/** Máximo de chars del summary — no debe inflar mucho el system prompt. */
const SUMMARY_MAX_CHARS = 600;

/**
 * Decide si toca actualizar el summary basado en cuántos mensajes nuevos
 * hubo desde la última actualización. Best-effort — si falla, no rompe
 * el flow del bot.
 */
export async function maybeUpdateSummary(opts: {
  tenantId: string;
  conversationId: string;
  customerName?: string | null;
}): Promise<void> {
  if (!opts.conversationId) return;

  // Lee estado actual de la conversación
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, summary, summary_message_count')
    .eq('id', opts.conversationId)
    .maybeSingle();
  if (!conv) return;

  // Cuenta mensajes totales de la conversación
  const { count: totalMsgs } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', opts.conversationId);
  if (!totalMsgs) return;

  const lastSummarized = (conv.summary_message_count as number) || 0;
  const newSinceSummary = totalMsgs - lastSummarized;

  // Solo actualizamos si hay al menos N nuevos mensajes
  if (newSinceSummary < UPDATE_EVERY_N_MESSAGES) return;

  // Trae los últimos 30 mensajes (suficiente contexto para summary)
  const { data: msgs } = await supabaseAdmin
    .from('messages')
    .select('direction, content, intent, created_at')
    .eq('conversation_id', opts.conversationId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (!msgs || msgs.length === 0) return;

  // Reverso para orden cronológico, decifrando PII
  const transcript = msgs
    .reverse()
    .map((m) => {
      const role = m.direction === 'inbound' ? 'Paciente' : 'Bot';
      const txt = decryptPII((m.content as string) || '') || (m.content as string) || '';
      return `${role}: ${txt.slice(0, 200)}`;
    })
    .join('\n');

  const prevSummary = (conv.summary as string) || '';
  const customerLabel = opts.customerName ? ` (paciente: ${opts.customerName})` : '';

  try {
    const { text } = await generateResponse({
      // Modelo BARATO — es just un resumen, no necesita razonamiento profundo.
      // Costo: ~50 tokens out × $0.40/M = $0.00002 por update.
      model: MODELS.STANDARD,
      system: `Generas un resumen narrativo en español MX de la conversación entre un paciente y un asistente médico de un consultorio${customerLabel}. Captura: temas mencionados, citas activas, preferencias del paciente, alergias/condiciones reveladas, decisiones tomadas. NO inventes nada que no esté en la conversación. Máximo ${SUMMARY_MAX_CHARS} caracteres. Responde SOLO el resumen, sin prefijos.`,
      messages: [
        {
          role: 'user',
          content:
            (prevSummary
              ? `Resumen previo:\n${prevSummary}\n\n---\nConversación reciente:\n${transcript}\n\nActualizá el resumen integrando lo nuevo.`
              : `Conversación:\n${transcript}\n\nGenerá el resumen.`),
        },
      ],
      maxTokens: 250,
      temperature: 0.3,
    });

    const summary = text.slice(0, SUMMARY_MAX_CHARS);
    if (!summary.trim()) return;

    await supabaseAdmin
      .from('conversations')
      .update({
        summary,
        summary_updated_at: new Date().toISOString(),
        summary_message_count: totalMsgs,
      })
      .eq('id', opts.conversationId);
  } catch (err) {
    // No bloquea el flow del bot — el summary es nice-to-have
    logger.warn('[conversation-summary] update failed', {
      tenant_id: opts.tenantId,
      conversation_id: opts.conversationId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Lee el summary actual de una conversación para inyectarlo en el system
 * prompt del orquestador. Devuelve string vacío si no existe — caller
 * concatena sin condición.
 */
export async function getConversationSummary(conversationId: string): Promise<string> {
  if (!conversationId) return '';
  try {
    const { data } = await supabaseAdmin
      .from('conversations')
      .select('summary')
      .eq('id', conversationId)
      .maybeSingle();
    const s = (data?.summary as string | null) || '';
    if (!s.trim()) return '';
    return `═══ RESUMEN DE LA CONVERSACIÓN ═══\n${s.trim()}\n═══════════════════════════════════════`;
  } catch {
    return '';
  }
}
