import { waitUntil } from '@vercel/functions';
import { sendTextMessage, sendTypingIndicator } from '@/lib/whatsapp/send';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  runOrchestrator,
  OrchestratorBothFailedError,
  RateLimitError,
  RATE_LIMIT_USER_MESSAGE,
  CircuitOpenError,
  CIRCUIT_OPEN_USER_MESSAGE,
  type OrchestratorContext,
} from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { getConversationContext } from '@/lib/intelligence/conversation-memory';
import {
  buildTenantContext,
  getSystemPrompt,
  routeToAgent,
  handleFAQ,
} from '@/lib/agents';
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { appendMedicalDisclaimer } from '@/lib/guardrails/validate';
import { getConversationState, clearConversationState, type ConversationState } from '@/lib/actions/state-machine';
import { encryptPII } from '@/lib/utils/crypto';
import { redactHistoryForLLM } from '@/lib/utils/logger';
import { HISTORY_MAX_MESSAGES, HISTORY_MAX_TOKENS } from '@/lib/config';
import { estimateTokens } from '@/lib/utils/token-estimate';
import type { TenantRecord } from './side-effects';
import { runPostResponseEffects } from './side-effects';

function truncateHistoryByTokens<T extends { content: string }>(
  messages: T[],
  maxTokens: number,
  keepRecent = 5,
): T[] {
  const collapsed: T[] = [];
  for (const m of messages) {
    const isReaction = /^\[Reacci[oó]n\b/.test(m.content || '');
    const prev = collapsed[collapsed.length - 1];
    const prevIsReaction = prev && /^\[Reacci[oó]n\b/.test(prev.content || '');
    if (isReaction && prevIsReaction) {
      continue;
    }
    collapsed.push(m);
  }
  messages = collapsed;
  if (messages.length <= keepRecent) return messages;
  const recent = messages.slice(-keepRecent);
  const older = messages.slice(0, -keepRecent);
  const recentTokens = recent.reduce((s, m) => s + estimateTokens(m.content), 0);
  let budget = maxTokens - recentTokens;
  if (budget <= 0) return recent;
  const kept: T[] = [];
  for (let i = older.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(older[i].content);
    if (tokens > budget) break;
    kept.unshift(older[i]);
    budget -= tokens;
  }
  return [...kept, ...recent];
}

import { guardUserInput } from '@/lib/guardrails/input-guard';
import { MAX_USER_INPUT_CHARS } from '@/lib/config';

function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, MAX_USER_INPUT_CHARS);
}

/**
 * Rinde el estado conversacional activo (awaiting_X + datos parciales) como
 * un bloque inyectable al system prompt del agente. Permite que el LLM
 * continúe un flow multi-turno iniciado en el pipeline clásico.
 */
export function formatStateContext(
  state: string,
  context: Record<string, unknown>,
): string {
  const humanState: Record<string, string> = {
    awaiting_appointment_date: 'El usuario está agendando una cita. Faltan datos que preguntar.',
    awaiting_modify_date: 'El usuario está reprogramando una cita existente.',
    awaiting_order_confirmation: 'El usuario está confirmando un pedido.',
    awaiting_reservation_details: 'El usuario está completando una reserva.',
    awaiting_survey_response:
      'El bot envió una encuesta de satisfacción y espera la respuesta del paciente. El siguiente mensaje del paciente es SU respuesta a la encuesta — parseala, llamá save_survey_response y cerrá el flow.',
    awaiting_appointment_confirmation:
      'El bot envió un recordatorio 24h antes de la cita y espera confirmación. Si el paciente confirma (ej. "sí, ahí estaré", "confirmo"), llamá mark_confirmed. Si dice que no puede, ofrecé reagendar y cedé a agenda.',
  };
  const description = humanState[state] || `Estado activo: ${state}.`;

  // Serialización controlada: solo keys conocidas y seguras (evitamos dump
  // bruto del JSONB que podría tener ruido o PII del flujo previo).
  const safeKeys = [
    'service', 'service_name', 'service_id',
    'date', 'time', 'datetime',
    'staff_id', 'staff_name',
    'patient_name', 'duration_minutes',
    'appointment_id', 'confirmation_code',
    'doctor_name',
    'notes',
  ];
  const partial: string[] = [];
  for (const k of safeKeys) {
    const v = context[k];
    if (v !== null && v !== undefined && v !== '') {
      partial.push(`- ${k}: ${String(v)}`);
    }
  }

  const body = partial.length > 0
    ? `\nDatos ya recogidos:\n${partial.join('\n')}\n\nContinúa donde quedaste. NO vuelvas a pedir lo que ya tienes arriba; pregunta solo lo que falta. Si el usuario cambia de tema, abandona este estado.`
    : '\nEl flow está recién iniciado. Pregunta los datos que faltan.';

  return `═══ ESTADO ACTIVO DE LA CONVERSACIÓN ═══\n${description}${body}`;
}

function safeUserMessage(raw: string): { content: string; flagged: boolean } {
  const cleaned = sanitizeInput(raw);
  const guard = guardUserInput(cleaned);
  if (guard.flagged) {
    console.warn('[guardrail] prompt injection patterns:', guard.reasons.slice(0, 3));
  }
  return { content: guard.sanitized, flagged: guard.flagged };
}

export interface OrchestratorBranchArgs {
  tenant: TenantRecord;
  conversationId: string;
  contactId: string;
  contactName: string;
  customerName: string;
  phoneNumberId: string;
  senderPhone: string;
  ragContext: string;
  content: string;
  intent: string;
}

export async function handleWithOrchestrator(args: OrchestratorBranchArgs): Promise<void> {
  const {
    tenant,
    conversationId,
    contactId,
    contactName,
    customerName,
    phoneNumberId,
    senderPhone,
    ragContext,
    content,
    intent,
  } = args;

  waitUntil(sendTypingIndicator(phoneNumberId, senderPhone).catch((err) => {
    console.warn('[orchestrator] typing indicator failed:', err instanceof Error ? err.message : err);
  }));

  // Pasamos el nombre conocido del contacto (profile.name de WhatsApp o el
  // que el cliente se presentó en mensajes previos) al contexto para que el
  // LLM no invente ni use el teléfono como nombre en book_appointment.
  const tenantCtx = buildTenantContext(
    tenant as unknown as Record<string, unknown>,
    { customerName: customerName || contactName, customerPhone: senderPhone },
  );

  const { isOptOutIntent } = await import('@/lib/whatsapp/opt-out-regex');
  if (isOptOutIntent(content)) {
    if (contactId) {
      await supabaseAdmin
        .from('contacts')
        .update({ opted_out: true, opted_out_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('tenant_id', tenant.id);
    }
    const optOutMsg = 'Listo, no le enviaremos más mensajes automatizados. Si desea reactivar las notificaciones, responda START.';
    await sendTextMessage(phoneNumberId, senderPhone, optOutMsg);
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenant.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: optOutMsg,
      message_type: 'text',
      intent: 'orchestrator.opt_out',
    });
    return;
  }

  const optInRegex = /\b(start|inicio|iniciar|alta|quiero\s+(recibir\s+)?mensajes|activar\s+(mis\s+)?(notificaci[oó]n(es)?|mensajes)|reactivar)\b/i;
  if (optInRegex.test(content) && content.length < 150 && contactId) {
    await supabaseAdmin
      .from('contacts')
      .update({ opted_out: false, opted_out_at: null })
      .eq('id', contactId)
      .eq('tenant_id', tenant.id);
    const optInMsg = '¡Listo! Sus notificaciones están activas de nuevo. ¿En qué le ayudo?';
    await sendTextMessage(phoneNumberId, senderPhone, optInMsg);
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenant.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: optInMsg,
      message_type: 'text',
      intent: 'orchestrator.opt_in',
    });
    return;
  }

  const confirmRegex = /\b(s[ií]+|confirmo|confirmado|ah[íi]\s*(voy|estar[eé])|asisto|asistir[eé]|cuento\s*con(\s*usted)?|ah[íí]\s*voy|claro\s*que\s*s[ií]+|por\s*supuesto)\b/i;
  const hasQuestion = /\?|¿|cu[áa]ndo|d[óo]nde|qu[ée]|c[óo]mo|por\s*qu[ée]/i.test(content);
  if (confirmRegex.test(content) && !hasQuestion && content.length < 120) {
    const { data: pendingAppt } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime')
      .eq('tenant_id', tenant.id)
      .eq('customer_phone', senderPhone)
      .eq('status', 'scheduled')
      .eq('no_show_reminded', true)
      .is('confirmed_at', null)
      .gt('datetime', new Date().toISOString())
      .order('datetime', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pendingAppt) {
      // Audit fix: optimistic locking — solo update si sigue en 'scheduled'
      // sin confirmed_at. Si dos webhooks colisionan (paciente manda doble
      // "sí"), el segundo no sobrescribe estado de cita ya confirmada/movida.
      await supabaseAdmin
        .from('appointments')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', pendingAppt.id)
        .eq('tenant_id', tenant.id)
        .eq('status', 'scheduled')
        .is('confirmed_at', null);

      const thankMsg = '¡Perfecto! Su cita está confirmada. Le esperamos con gusto. 😊';
      await sendTextMessage(phoneNumberId, senderPhone, thankMsg);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: thankMsg,
        message_type: 'text',
        intent: 'orchestrator.confirm_fast_path',
      });
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
      return;
    }
  }

  const fastRoute = routeToAgent(content, tenantCtx);

  if (fastRoute === 'urgent') {
    const emergencyContact =
      tenantCtx.emergencyPhone || (tenant.phone as string | undefined) || '';
    const urgentMsg = emergencyContact
      ? `Entiendo que es urgente. Por favor comuníquese inmediatamente al ${emergencyContact}. Estamos para ayudarle.`
      : `Entiendo que es urgente. Vamos a contactarle de inmediato. Si necesita ayuda médica, marque al 911.`;
    await sendTextMessage(phoneNumberId, senderPhone, urgentMsg);
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenant.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: urgentMsg,
      message_type: 'text',
      intent: 'orchestrator.urgent',
    });
    await supabaseAdmin
      .from('conversations')
      .update({
        status: 'human_handoff',
        tags: ['urgent', 'fast_path'],
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      await notifyOwner({
        tenantId: tenant.id,
        event: 'emergency',
        details: `Urgencia detectada por fast path:\n${senderPhone}\n"${content.slice(0, 200)}"`,
      });
    } catch (err) {
      console.warn('[orchestrator-branch] notifyOwner urgent failed:', err instanceof Error ? err.message : err);
    }
    return;
  }

  if (fastRoute === 'faq') {
    const faqAnswer = await handleFAQ(content, tenant.id);
    if (faqAnswer) {
      await sendTextMessage(phoneNumberId, senderPhone, faqAnswer);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: faqAnswer,
        message_type: 'text',
        intent: 'orchestrator.faq_fast_path',
      });
      await runPostResponseEffects(
        tenant,
        phoneNumberId,
        senderPhone,
        conversationId,
        contactId,
        contactName,
        customerName,
        intent,
        content,
      );
      await supabaseAdmin
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          customer_name: contactName || customerName,
        })
        .eq('id', conversationId);
      return;
    }
  }

  const rawHistory = await getConversationContext(conversationId, HISTORY_MAX_MESSAGES);
  const history = truncateHistoryByTokens(rawHistory, HISTORY_MAX_TOKENS);

  const safeMsg = safeUserMessage(content);
  const orchestratorMessages = [
    ...redactHistoryForLLM(history).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: safeMsg.content },
  ];

  // Conversation state — leído antes del routing para poder derivarlo
  // desde estados outbound (AWAITING_SURVEY_RESPONSE,
  // AWAITING_APPOINTMENT_CONFIRMATION). Si falla la lectura default a null
  // (no tenemos memoria — tratamos como conversación fresca).
  const convState = await getConversationState(conversationId).catch(() => ({
    state: null as ConversationState,
    context: {} as Record<string, unknown>,
  }));

  // Contacto: traer name + intake_completed para decidir intake vs agenda
  // cuando no hay state outbound activo.
  const { data: contactRow } = contactId
    ? await supabaseAdmin
        .from('contacts')
        .select('name, intake_completed')
        .eq('id', contactId)
        .maybeSingle()
    : { data: null };

  const hasName = Boolean(contactRow?.name && String(contactRow.name).trim());
  const intakeDone = contactRow?.intake_completed === true;
  const needsIntake = !hasName || !intakeDone;

  // Routing priority:
  //   1. State outbound pendiente (survey / appointment confirmation)
  //      → rutea al sub-agente que sabe procesar ese tipo de respuesta.
  //   2. Nuevo paciente sin intake → intake.
  //   3. Keyword-based topic classifier (Phase 1 subagents) — pharmacovigilance,
  //      payment, administrative, quoting, doctor-profile.
  //   4. Default → agenda.
  //
  // El keyword classifier es intencionalmente simple (regex + case-fold).
  // Para producción se podría upgradear a LLM-classifier, pero un LLM para
  // elegir agente + LLM dentro del agente duplica costo. Mantenemos regex
  // y dejamos que el prompt de cada agente maneje casos ambiguos.
  const msgNorm = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  type AgentName = 'encuesta' | 'no-show' | 'intake' | 'agenda'
    | 'quoting' | 'pharmacovigilance' | 'administrative'
    | 'doctor-profile' | 'payment-resolution' | 'treatment-coach' | 'triaje';

  function detectTopicAgent(): AgentName | null {
    // Triaje clínico — el paciente reporta síntoma con preocupación pero no
    // es claramente reacción a medicamento (eso ya cae en pharmacovigilance).
    // Patterns: "me duele mucho", "no sé si esperar", "creo que algo está mal",
    // "tengo fiebre", "me siento mal hace X días". Triaje hace preguntas
    // estructuradas ANTES de agendar, clasifica urgencia, deriva a doctor o
    // ER si nivel 1-2.
    if (
      /\b(me duele mucho|dolor (muy fuerte|severo|insoportable|10 de 10|9 de 10)|no se si (esperar|sera grave|es algo serio)|algo (esta mal|anda mal)|tengo fiebre|llevo (varios|\d+) (dias|días|horas) con|empeora|cada vez peor|estoy preocupad[oa]|muy mal del?|que tan grave es|sera grave)\b/i.test(msgNorm)
      || /\b(sintomas?|síntomas?) (graves?|raros?|de alarma|preocupantes?)\b/i.test(msgNorm)
    ) {
      return 'triaje';
    }

    // Pharmacovigilance — PRIORIDAD ALTA: cualquier reporte de reacción es
    // safety-critical. Debe ganar antes que quoting/admin (que pueden
    // mencionar "medicamento" sin ser reacción adversa).
    if (
      /(reaccion|alergi|efecto|me salio|me salieron|ronchas|sarpullido|vomit|mareo|ardor) (a|al|despues|tras|de tomar|de la pastilla|de la medicina)|(me hizo mal|me cayo mal|me siento mal).{0,30}(pastilla|medicina|medicamento)/i.test(msgNorm)
      || /despues de tomar|tras la dosis|tras tomar/i.test(msgNorm)
    ) {
      return 'pharmacovigilance';
    }

    // Payment resolution — disputas + facturas fiscales. Audit fix:
    // 'cuanto he pagado' / 'historial de pago' eran muy laxas y rutaban
    // a payment-resolution preguntas inocentes ("cuanto he pagado por mis
    // citas" → debería ser agenda). Ahora requerimos OR un keyword fuerte
    // (disputa/factura/RFC) O combinación de "cuanto/historial" + indicador
    // fiscal.
    if (
      /\b(disputa|reembolso|cobro indebido|doble cobro|no reconozco|por que me cobran|facturar|factura|recibo cfdi|rfc)\b/i.test(msgNorm)
      || (/\b(historial de pago|cuanto he pagado)\b/i.test(msgNorm)
          && /\b(impuestos|deducir|deducible|sat|fiscal|contador)\b/i.test(msgNorm))
    ) {
      return 'payment-resolution';
    }

    // Administrative — certificados, expedientes, consentimientos.
    if (
      /\b(certificad|justificante|constancia|incapacidad|expediente|transferir.{0,20}expediente|consentimiento|permiso para.{0,20}(hijo|menor|procedimiento))\b/i.test(msgNorm)
    ) {
      return 'administrative';
    }

    // Doctor profile — preguntas sobre el doctor.
    if (
      /\b(quien atiende|experiencia del doctor|que estudios|curriculum|cv del|biograf|es especialist|es ortodoncist|es endodoncist|tiene experiencia con|tiene casos de)\b/i.test(msgNorm)
    ) {
      return 'doctor-profile';
    }

    // Treatment coach — paciente en tratamiento multi-sesión (orto, fisio,
    // implante, rehab) quiere gestionar su plan o próxima sesión. Se matchea
    // ANTES de quoting/agenda porque el contexto del plan cambia la respuesta
    // esperada (cadence clínico, sesiones restantes) y el agente de
    // treatment-coach invoca get_patient_treatment_plan para confirmar que
    // realmente hay plan activo antes de continuar.
    if (
      /\b(mi tratamiento|mi ortodonci|mi brackets?|mis brackets?|mi fisio|mi terapia|mi rehab|mi rehabilitaci|mi endodonci|mi implante|mi plan de tratamiento|proxima sesion|próxima sesión|siguiente sesion|siguiente sesión|cuantas sesiones|cuántas sesiones|sesion(es)? que me faltan|sesiones restantes|ajuste de brackets|darme de baja del tratamiento|ya no voy a seguir con el tratamiento|pausar (mi )?tratamiento)\b/i.test(msgNorm)
    ) {
      return 'treatment-coach';
    }

    // Quoting — pregunta precio SIN intent inmediato de agendar.
    // "¿cuánto cuesta X?" / "¿tienen paquete?" / "¿precio de Y?"
    // Distinguir de agendamiento: si además dice "agendar/cita" en el mismo
    // mensaje, dejamos que agenda tome ese flow (cotiza + agenda).
    if (
      /\b(cuanto cuesta|cuanto sale|precio|costo|cuotiza|paquete|promocion|descuento|tarifa)\b/i.test(msgNorm)
      && !/\b(agendar|agendo|cita|reservar|reservo|cuando puedo)\b/i.test(msgNorm)
    ) {
      return 'quoting';
    }

    return null;
  }

  let agentName: AgentName = 'agenda';
  // Audit fix: detectTopicAgent() corre PRIMERO porque urgency/triaje deben
  // ganar incluso si el paciente está en awaiting_X. Antes el state trap
  // mantenía intake activo si el paciente decía "me duele el pecho" en
  // medio del flow → emergencia perdida.
  const topicAgent = detectTopicAgent();
  const isUrgent = topicAgent === 'triaje' || topicAgent === 'pharmacovigilance';

  if (isUrgent && convState.state) {
    // Limpio el state — el flow previo (intake/survey/confirm) queda abortado.
    // El paciente está reportando algo grave; lo otro espera.
    await clearConversationState(conversationId);
    agentName = topicAgent;
  } else if (convState.state === 'awaiting_survey_response') {
    agentName = 'encuesta';
  } else if (convState.state === 'awaiting_appointment_confirmation') {
    agentName = 'no-show';
  } else if (needsIntake) {
    agentName = 'intake';
  } else if (topicAgent) {
    agentName = topicAgent;
  }

  const agentConfig = AGENT_REGISTRY[agentName];
  const tools = getToolSchemas(agentConfig.tools);
  const baseSystemPrompt = getSystemPrompt(agentName, tenantCtx);

  // State recovery — si hay state activo (de cualquier tipo) lo inyectamos
  // al system prompt para que el agente sepa qué datos ya tiene.
  const systemPrompt = convState.state
    ? `${baseSystemPrompt}\n\n${formatStateContext(convState.state, convState.context)}`
    : baseSystemPrompt;

  const orchestratorCtx: OrchestratorContext = {
    tenantId: tenant.id,
    contactId,
    conversationId,
    customerPhone: senderPhone,
    customerName,
    tenant: tenant as unknown as Record<string, unknown>,
    businessType: (tenant.business_type as string) || 'other',
    messages: orchestratorMessages,
    tools,
    systemPrompt,
    agentName,
  };

  // DIAG: log tools que se pasan al LLM. Aparecerá en Vercel logs.
  // Útil para confirmar que getToolSchemas() encuentra las tools registradas.
  console.log('[orch-diag]', JSON.stringify({
    agent: agentName,
    tools_count: tools.length,
    tools_names: tools.map((t) => 'function' in t ? t.function.name : (t as { name?: string }).name ?? '?'),
    config_tools: agentConfig.tools,
    msgs_count: orchestratorMessages.length,
  }));

  const startMs = Date.now();
  let responseText: string;
  let modelUsed = 'orchestrator-failed';
  let fallbackUsed = false;
  let toolCallsExecuted: Awaited<ReturnType<typeof runOrchestrator>>['toolCallsExecuted'] = [];
  let costUsd = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const result = await runOrchestrator(orchestratorCtx);
    responseText = result.responseText
      || 'Permítame un momento, le respondo enseguida.';
    modelUsed = result.modelUsed;
    fallbackUsed = result.fallbackUsed;
    toolCallsExecuted = result.toolCallsExecuted;
    costUsd = result.costUsd;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    // DIAG: log result. Vercel logs nos dirán si el LLM hizo tool_calls
    // o solo respondió texto.
    console.log('[orch-diag-result]', JSON.stringify({
      agent: agentName,
      model: modelUsed,
      fallback: fallbackUsed,
      tool_calls_count: toolCallsExecuted.length,
      tool_calls_names: toolCallsExecuted.map((c) => c.toolName),
      response_text_preview: (responseText || '').slice(0, 100),
    }));
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      console.warn('[orchestrator] circuit breaker OPEN; retry_after=', err.retryAfter);
      responseText = CIRCUIT_OPEN_USER_MESSAGE;
    } else if (err instanceof RateLimitError) {
      console.warn('[orchestrator] rate limited:', err.scope, 'retry_after=', err.retryAfter);
      responseText = RATE_LIMIT_USER_MESSAGE;
    } else if (err instanceof OrchestratorBothFailedError) {
      console.error('[orchestrator] both models failed:', err.message);
      responseText =
        'Tuvimos un problema técnico momentáneo. Ya avisé al equipo y lo contactarán en breve.';
    } else {
      console.error('[orchestrator] unexpected error:', err);
      responseText =
        'Tuvimos un problema técnico momentáneo. Ya avisé al equipo y lo contactarán en breve.';
    }
  }

  const responseTimeMs = Date.now() - startMs;

  responseText = appendMedicalDisclaimer(content, responseText);

  await sendTextMessage(phoneNumberId, senderPhone, responseText);

  // Mantener intent simple para no romper analytics/triggers downstream que
  // hacen exact match en valores como 'orchestrator.intake'.
  // El diag de tools va a logs (console.log [orch-diag-result]) — ya está
  // ahí para debugging sin impactar el campo intent.
  const baseIntent = `orchestrator.${agentName}`;

  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: encryptPII(responseText),
    message_type: 'text',
    intent: baseIntent,
    model_used: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
    response_time_ms: responseTimeMs,
    confidence: fallbackUsed ? 0.7 : 0.9,
  });

  if (toolCallsExecuted.length > 0) {
    try {
      await supabaseAdmin.from('tool_call_logs').insert(
        toolCallsExecuted.map((tc) => ({
          tenant_id: tenant.id,
          conversation_id: conversationId,
          agent_name: agentName,
          tool_name: tc.toolName,
          args: tc.args,
          result: tc.result,
          success: !tc.error,
          error_message: tc.error || null,
          duration_ms: tc.durationMs,
          model_used: modelUsed,
          fallback_used: fallbackUsed,
        })),
      );
    } catch (logErr) {
      console.warn('[orchestrator] tool_call_logs insert failed:', logErr);
    }
  }

  await runPostResponseEffects(
    tenant,
    phoneNumberId,
    senderPhone,
    conversationId,
    contactId,
    contactName,
    customerName,
    intent,
    content,
  );

  await supabaseAdmin
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      customer_name: contactName || customerName,
    })
    .eq('id', conversationId);
}
