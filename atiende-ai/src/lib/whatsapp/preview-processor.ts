// ═════════════════════════════════════════════════════════════════════════════
// PREVIEW PROCESSOR — ejecuta el pipeline agéntico SIN WhatsApp
//
// Reutiliza los mismos building blocks que el pipeline productivo:
//   - buildTenantContext  (fechas en TZ del tenant + servicios)
//   - routeToAgent        (fast path: urgent / faq)
//   - handleFAQ           (respuesta directa desde faq_embeddings)
//   - runOrchestrator     (tool calling real: book_appointment, etc.)
//
// Diferencias vs processor.ts:
//   - No verifica HMAC ni envía por WhatsApp API
//   - Salta checkGates (business hours, rate limit, etc.) — es un preview
//   - Usa contact + conversation "preview-{userId}" para aislar del real
//   - No usa atomic upsert; inserta inbound/outbound simple
//   - Siempre corre orchestrator (aunque USE_TOOL_CALLING esté off) — el
//     objetivo del preview ES probar las tools
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildRagContext } from '@/lib/whatsapp/rag-context';
import { runOrchestrator, type OrchestratorContext } from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import {
  buildTenantContext,
  getSystemPrompt,
  routeToAgent,
  handleFAQ,
  ensureToolsRegistered,
  AGENT_REGISTRY,
} from '@/lib/agents';

try { ensureToolsRegistered(); } catch { /* non-fatal in preview */ }

const PREVIEW_PHONE_PREFIX = 'preview:';
const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_LENGTH = 500;

export interface PreviewTurnInput {
  tenantId: string;
  userId: string;
  message: string;
}

export interface PreviewTurnResult {
  reply: string;
  toolCalls: Array<{ name: string; ok: boolean; error?: string }>;
  modelUsed: string;
  agentUsed: string;
}

interface TenantRow {
  id: string;
  name: string;
  business_type: string;
  welcome_message: string | null;
  timezone: string | null;
  business_hours: Record<string, string> | null;
  phone: string | null;
  [key: string]: unknown;
}

async function getOrCreatePreviewContact(
  tenantId: string,
  userId: string,
): Promise<{ contactId: string; conversationId: string }> {
  const previewPhone = `${PREVIEW_PHONE_PREFIX}${userId}`;

  let { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', previewPhone)
    .maybeSingle();

  if (!contact) {
    const { data: inserted } = await supabaseAdmin
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        phone: previewPhone,
        name: 'Preview (owner)',
      })
      .select('id')
      .single();
    contact = inserted;
  }
  if (!contact) throw new Error('Could not create preview contact');

  let { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_phone', previewPhone)
    .eq('channel', 'preview')
    .maybeSingle();

  if (!conv) {
    const { data: inserted } = await supabaseAdmin
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        contact_id: contact.id,
        customer_phone: previewPhone,
        channel: 'preview',
        status: 'active',
        customer_name: 'Preview (owner)',
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    conv = inserted;
  }
  if (!conv) throw new Error('Could not create preview conversation');

  return { contactId: contact.id, conversationId: conv.id };
}

export async function processPreviewMessage(
  input: PreviewTurnInput,
): Promise<PreviewTurnResult> {
  const rawMessage = (input.message || '').trim().slice(0, MAX_INPUT_LENGTH);
  if (!rawMessage) throw new Error('Empty message');

  const { data: tenantRow, error: tenantErr } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('id', input.tenantId)
    .single();

  if (tenantErr || !tenantRow) throw new Error('Tenant not found');
  const tenant = tenantRow as TenantRow;

  const { contactId, conversationId } = await getOrCreatePreviewContact(
    tenant.id,
    input.userId,
  );
  const previewPhone = `${PREVIEW_PHONE_PREFIX}${input.userId}`;

  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: tenant.id,
    direction: 'inbound',
    sender_type: 'user',
    content: rawMessage,
    message_type: 'text',
  });

  const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);

  // Fast path: urgent
  const fastRoute = routeToAgent(rawMessage, tenantCtx);
  if (fastRoute === 'urgent') {
    const emergency = tenantCtx.emergencyPhone || tenant.phone || '';
    const reply = emergency
      ? `Entiendo que es urgente. Por favor comuníquese inmediatamente al ${emergency}.`
      : 'Entiendo que es urgente. Vamos a contactarle de inmediato. Si necesita ayuda médica, marque al 911.';
    await persistOutbound(conversationId, tenant.id, reply, 'preview.urgent');
    return { reply, toolCalls: [], modelUsed: 'fast-path', agentUsed: 'urgent' };
  }

  if (fastRoute === 'faq') {
    const faqAnswer = await handleFAQ(rawMessage, tenant.id);
    if (faqAnswer) {
      await persistOutbound(conversationId, tenant.id, faqAnswer, 'preview.faq');
      return { reply: faqAnswer, toolCalls: [], modelUsed: 'fast-path', agentUsed: 'faq' };
    }
  }

  const { ragContext } = await buildRagContext(tenant.id, rawMessage, conversationId);

  const { data: historyRows } = await supabaseAdmin
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  const history = (historyRows || [])
    .reverse()
    .slice(0, -1)
    .filter((m) => m.content)
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content as string,
    }));

  const agentName: 'agenda' = 'agenda';
  const agentConfig = AGENT_REGISTRY[agentName];
  const tools = getToolSchemas(agentConfig.tools);
  const systemPrompt =
    getSystemPrompt(agentName, tenantCtx) +
    (ragContext ? `\n\n## Contexto del negocio\n${ragContext}` : '') +
    '\n\n[MODO PREVIEW — estás hablando con el dueño del negocio probando el agente. Actúa exactamente como en producción.]';

  const orchestratorCtx: OrchestratorContext = {
    tenantId: tenant.id,
    contactId,
    conversationId,
    customerPhone: previewPhone,
    customerName: 'Preview',
    tenant: tenant as unknown as Record<string, unknown>,
    businessType: tenant.business_type || 'other',
    messages: [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: rawMessage },
    ],
    tools,
    systemPrompt,
    agentName,
  };

  const result = await runOrchestrator(orchestratorCtx);

  await persistOutbound(
    conversationId,
    tenant.id,
    result.responseText,
    'preview.orchestrator',
    result.modelUsed,
  );

  return {
    reply: result.responseText,
    toolCalls: result.toolCallsExecuted.map((t) => ({
      name: t.toolName,
      ok: !t.error,
      error: t.error || undefined,
    })),
    modelUsed: result.modelUsed,
    agentUsed: result.agentUsed,
  };
}

async function persistOutbound(
  conversationId: string,
  tenantId: string,
  content: string,
  intent: string,
  model?: string,
): Promise<void> {
  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: tenantId,
    direction: 'outbound',
    sender_type: 'bot',
    content,
    message_type: 'text',
    intent,
    model_used: model || null,
  });
  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}
