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

  waitUntil(sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {}));

  const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);

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
      await supabaseAdmin
        .from('appointments')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', pendingAppt.id);

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

  const agentName = 'agenda' as const;
  const agentConfig = AGENT_REGISTRY[agentName];
  const tools = getToolSchemas(agentConfig.tools);
  const systemPrompt = getSystemPrompt(agentName, tenantCtx);

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

  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: encryptPII(responseText),
    message_type: 'text',
    intent: `orchestrator.${agentName}`,
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
