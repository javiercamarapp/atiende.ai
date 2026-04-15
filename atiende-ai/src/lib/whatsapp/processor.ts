import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, markAsRead, sendTypingIndicator } from '@/lib/whatsapp/send';
import { transcribeAudio } from '@/lib/voice/deepgram';
import { checkRateLimit, checkTenantLimit } from '@/lib/rate-limit';
import { resolveIntent } from '@/lib/whatsapp/classifier';
import { buildRagContext } from '@/lib/whatsapp/rag-context';
import { generateAndValidateResponse } from '@/lib/whatsapp/response-builder';
import {
  runOrchestrator,
  OrchestratorBothFailedError,
  RateLimitError,
  RATE_LIMIT_USER_MESSAGE,
  type OrchestratorContext,
} from '@/lib/llm/orchestrator';
import { getToolSchemas } from '@/lib/llm/tool-executor';
import { getConversationContext } from '@/lib/intelligence/conversation-memory';
import {
  buildTenantContext,
  getSystemPrompt,
  routeToAgent,
  handleFAQ,
  initializeAllAgents,
} from '@/lib/agents';

// Boot-time verification — corre UNA VEZ al cargar el módulo. Si algún
// agente falló al registrar sus tools, mejor saberlo en el cold start que
// al recibir el primer mensaje del paciente.
const __agentsInit = initializeAllAgents();
if (!__agentsInit.ok) {
  console.error('[processor] agents init incomplete — missing:', __agentsInit.missing);
}
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { appendMedicalDisclaimer } from '@/lib/guardrails/validate';
import {
  acquireConversationLock,
  releaseConversationLock,
} from '@/lib/whatsapp/conversation-lock';
import { maskPhone } from '@/lib/utils/logger';
import * as mediaProcessor from '@/lib/whatsapp/media-processor';

// ─────────────────────────────────────────────────────────────────────────────
// Tool calling pipeline (Fase 1) — feature flag
//
// Lee la misma env var que la route file. Cuando es false (default en
// producción), el pipeline tradicional corre intacto.
// ─────────────────────────────────────────────────────────────────────────────
const USE_TOOL_CALLING = process.env.USE_TOOL_CALLING === 'true';

/**
 * Decide si este tenant tiene activado el tool-calling pipeline. Aún con la
 * env var global encendida, solo activamos por tenant para hacer rollout
 * gradual sin redeploy.
 */
function tenantHasToolCallingEnabled(tenant: Record<string, unknown>): boolean {
  const features = tenant.features as Record<string, unknown> | undefined;
  return features?.tool_calling === true;
}

function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, 4096);
}

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value: {
        messages?: WhatsAppMessage[];
        metadata: { phone_number_id: string; display_phone_number: string };
      };
    }>;
  }>;
}

interface WhatsAppMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  voice?: { id: string; mime_type?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string; mime_type?: string; caption?: string };
  video?: { id?: string; caption?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: string;
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
  reaction?: { message_id: string; emoji: string };
  sticker?: { id: string };
  contacts?: Array<{ profile?: { name?: string } }>;
}

interface TenantRecord {
  id: string;
  name: string;
  status: string;
  plan: string;
  business_type?: string;
  wa_phone_number_id: string;
  welcome_message?: string;
  chat_system_prompt?: string;
  temperature?: number;
  address?: string;
  [key: string]: unknown;
}

export async function processIncomingMessage(body: WhatsAppWebhookBody) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value.messages) continue;
      for (const msg of value.messages) {
        await handleSingleMessage(msg, value.metadata);
      }
    }
  }
}

// -- Gate checks (rate limits, plan, business hours) --

async function checkGates(
  tenant: TenantRecord,
  senderPhone: string,
  phoneNumberId: string,
): Promise<boolean> {
  // Rate limiting
  const rateLimited = await checkRateLimit(senderPhone);
  if (!rateLimited.allowed) return false;

  const tenantLimited = await checkTenantLimit(tenant.id, tenant.plan);
  if (!tenantLimited.allowed) return false;

  // Trial expiry
  if (tenant.plan === 'free_trial' && tenant.trial_ends_at) {
    const trialEnd = new Date(tenant.trial_ends_at as string);
    if (trialEnd < new Date()) {
      await sendTextMessage(
        phoneNumberId,
        senderPhone,
        'Tu periodo de prueba ha terminado. Para seguir usando nuestro servicio, por favor actualiza tu plan en el panel de administracion. Gracias por probar nuestro servicio.',
      );
      return false;
    }
  }

  // Monthly message cap
  const planMsgLimits: Record<string, number> = { free_trial: 50, basic: 500, pro: 2000, premium: 10000 };
  const monthlyLimit = planMsgLimits[tenant.plan] || 50;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { count: monthlyCount } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('direction', 'outbound')
    .eq('sender_type', 'bot')
    .gte('created_at', monthStart.toISOString());

  if ((monthlyCount ?? 0) >= monthlyLimit) {
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Hemos alcanzado el limite de mensajes de este mes para tu plan. Para continuar recibiendo respuestas automaticas, por favor actualiza tu plan. Disculpa las molestias.',
    );
    return false;
  }

  // Business hours
  try {
    const { isBusinessOpen, getNextOpenTime } = await import('@/lib/actions/business-hours');
    const hours = tenant.business_hours as Record<string, string> | null;
    if (!isBusinessOpen(hours)) {
      const nextOpen = getNextOpenTime(hours);
      await sendTextMessage(
        phoneNumberId,
        senderPhone,
        `🌙 Gracias por escribirnos. En este momento estamos fuera de horario. Abrimos ${nextOpen}. Le responderemos a primera hora. ¡Que tenga buena noche!`,
      );
      return false;
    }
  } catch {
    /* Best effort — continue processing if hours check fails */
  }

  return true;
}

// -- Extract text content from any WhatsApp message type --
//
// Versión legacy (sin tenantId, usa Deepgram para audio). Mantenida para no
// romper otros callers; nueva pipeline usa extractContentAsync abajo.

async function extractContent(msg: WhatsAppMessage): Promise<{ content: string; messageType: string }> {
  let content = '';
  let messageType = msg.type;

  switch (msg.type) {
    case 'text':
      content = msg.text?.body || '';
      break;
    case 'audio':
      content = msg.audio?.id ? await transcribeAudio(msg.audio.id) : '[Audio no disponible]';
      messageType = 'audio';
      break;
    case 'image':
      content = msg.image?.caption ? `[Imagen: ${msg.image.caption}]` : '[Imagen recibida]';
      break;
    case 'document':
      content = `[Documento: ${msg.document?.filename || 'archivo'}]`;
      break;
    case 'location':
      content = `[Ubicacion: ${msg.location?.latitude},${msg.location?.longitude}]`;
      break;
    case 'interactive':
      if (msg.interactive?.type === 'button_reply') {
        content = msg.interactive.button_reply?.title || '';
      } else if (msg.interactive?.type === 'list_reply') {
        content = msg.interactive.list_reply?.title || '';
      }
      break;
    case 'sticker':
      content = '[Sticker]';
      break;
    default:
      content = `[${msg.type} recibido]`;
  }

  return { content: sanitizeInput(content), messageType };
}

// -- Multimedia extractor (MISIÓN 2) --
//
// Procesa audio (Whisper), imagen (Gemini Vision), PDF (pdf-parse + Gemini
// fallback). Retorna además metadata para persistir en messages.media_*.

interface ExtractedContent {
  content: string;
  messageType: string;
  mediaTranscription?: string;
  mediaDescription?: string;
}

async function extractContentAsync(
  msg: WhatsAppMessage,
  tenantId: string,
): Promise<ExtractedContent> {
  switch (msg.type) {
    case 'text':
      return { content: sanitizeInput(msg.text?.body || ''), messageType: 'text' };

    case 'audio':
    case 'voice': {
      const id = msg.audio?.id || msg.voice?.id;
      if (!id) return { content: '[Audio no disponible]', messageType: 'audio' };
      const r = await mediaProcessor.transcribeAudio(id, tenantId);
      if (!r.ok || !r.text) {
        return { content: '[No pude entender el audio. ¿Puedes escribirlo?]', messageType: 'audio' };
      }
      return {
        content: sanitizeInput(r.text),
        messageType: 'audio',
        mediaTranscription: r.text,
      };
    }

    case 'image': {
      if (!msg.image?.id) {
        return {
          content: msg.image?.caption ? sanitizeInput(msg.image.caption) : '[Imagen]',
          messageType: 'image',
        };
      }
      const r = await mediaProcessor.describeImage(msg.image.id, tenantId, msg.image.caption);
      if (!r.ok || !r.text) {
        return {
          content: msg.image?.caption ? sanitizeInput(msg.image.caption) : '[Imagen recibida — no pude analizarla]',
          messageType: 'image',
        };
      }
      const captionPart = msg.image.caption ? `${msg.image.caption}\n` : '';
      return {
        content: sanitizeInput(`${captionPart}[Imagen: ${r.text}]`),
        messageType: 'image',
        mediaDescription: r.text,
      };
    }

    case 'document': {
      if (!msg.document?.id) {
        return { content: `[Documento: ${msg.document?.filename || 'archivo'}]`, messageType: 'document' };
      }
      const isPdf = (msg.document.mime_type || '').includes('pdf')
        || (msg.document.filename || '').toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        return {
          content: `[Documento ${msg.document.filename || 'archivo'} — solo proceso PDFs por ahora]`,
          messageType: 'document',
        };
      }
      const r = await mediaProcessor.extractPdfText(msg.document.id, tenantId, msg.document.filename);
      if (!r.ok || !r.text) {
        return {
          content: `[PDF ${msg.document.filename || ''} — no pude leerlo]`,
          messageType: 'document',
        };
      }
      return {
        content: sanitizeInput(r.text),
        messageType: 'document',
        mediaDescription: r.text,
      };
    }

    case 'location':
      return {
        content: `[Ubicación compartida: ${msg.location?.latitude},${msg.location?.longitude}]`,
        messageType: 'location',
      };

    case 'interactive': {
      let content = '';
      if (msg.interactive?.type === 'button_reply') {
        content = msg.interactive.button_reply?.title || '';
      } else if (msg.interactive?.type === 'list_reply') {
        content = msg.interactive.list_reply?.title || '';
      }
      return { content: sanitizeInput(content), messageType: 'interactive' };
    }

    case 'sticker':
      return { content: '[Sticker]', messageType: 'sticker' };

    case 'reaction':
      return {
        content: `[Reacción ${msg.reaction?.emoji || ''}]`,
        messageType: 'reaction',
      };

    case 'video':
      return {
        content: `[Video recibido${msg.video?.caption ? `: ${msg.video.caption}` : ''} — no proceso video aún]`,
        messageType: 'video',
      };

    default:
      return { content: `[${msg.type} recibido]`, messageType: msg.type };
  }
}

// -- Post-response side effects (actions, scoring, notifications) --

async function runPostResponseEffects(
  tenant: TenantRecord,
  phoneNumberId: string,
  senderPhone: string,
  conversationId: string,
  contactId: string,
  contactName: string,
  customerName: string,
  intent: string,
  content: string,
) {
  // Agentic actions
  try {
    const { executeAction } = await import('@/lib/actions/engine');
    const actionResult = await executeAction({
      tenantId: tenant.id,
      phoneNumberId,
      customerPhone: senderPhone,
      customerName,
      contactId,
      conversationId,
      intent,
      content,
      businessType: tenant.business_type as string,
      tenant,
    });
    if (actionResult.actionTaken && actionResult.followUpMessage) {
      await sendTextMessage(phoneNumberId, senderPhone, actionResult.followUpMessage);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: actionResult.followUpMessage,
        message_type: 'text',
        intent: `action.${actionResult.actionType}`,
      });
    }

    // Notify owner for critical actions
    if (
      actionResult.actionTaken &&
      ['order.created', 'complaint.escalated', 'emergency.escalated', 'crisis.detected', 'appointment.created'].includes(actionResult.actionType || '')
    ) {
      try {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        const eventMap: Record<string, 'new_order' | 'new_appointment' | 'complaint' | 'emergency' | 'crisis'> = {
          'order.created': 'new_order',
          'complaint.escalated': 'complaint',
          'emergency.escalated': 'emergency',
          'crisis.detected': 'crisis',
          'appointment.created': 'new_appointment',
        };
        await notifyOwner({
          tenantId: tenant.id,
          event: eventMap[actionResult.actionType!] || 'new_order',
          details: `Cliente: ${senderPhone}\n${actionResult.followUpMessage?.slice(0, 200) || ''}`,
        });
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* Actions are best-effort */
  }

  // Industry-specific actions
  try {
    const { executeIndustryAction } = await import('@/lib/actions/industry-actions');
    const industryResult = await executeIndustryAction({
      tenantId: tenant.id,
      phoneNumberId,
      customerPhone: senderPhone,
      customerName,
      contactId,
      conversationId,
      businessType: tenant.business_type as string,
      tenant,
      intent,
      content,
    });
    if (industryResult.acted && industryResult.message) {
      await sendTextMessage(phoneNumberId, senderPhone, industryResult.message);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: industryResult.message,
        message_type: 'text',
        intent: `industry.${tenant.business_type}`,
      });
    }
  } catch {
    /* best effort */
  }

  // Lead scoring
  try {
    const { updateLeadScore } = await import('@/lib/actions/lead-scoring');
    await updateLeadScore(contactId, intent);
  } catch {
    /* best effort */
  }

  // Hot lead routing
  try {
    if (contactId) {
      const { data: updatedContact } = await supabaseAdmin
        .from('contacts')
        .select('lead_score, lead_temperature')
        .eq('id', contactId)
        .single();
      if (updatedContact?.lead_temperature === 'hot' && updatedContact.lead_score >= 70) {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        await notifyOwner({
          tenantId: tenant.id,
          event: 'lead_hot',
          details: `🔥 LEAD CALIENTE (Score: ${updatedContact.lead_score}/100)\n\nCliente: ${contactName || senderPhone}\nTel: ${senderPhone}\nÚltimo intent: ${intent}\n\n¡Contacte a este cliente AHORA!`,
        });
      }
    }
  } catch {
    /* best effort */
  }
}

// -- Main message handler --

async function handleSingleMessage(
  msg: WhatsAppMessage,
  metadata: { phone_number_id: string; display_phone_number: string },
) {
  const senderPhone = msg.from;
  const phoneNumberId = metadata.phone_number_id;
  const messageId = msg.id;

  // 0. Idempotency check — Meta reintenta webhooks en timeouts (<5s). Sin
  //    este chequeo procesamos el mismo mensaje dos veces: 2x LLM calls,
  //    2x outbound replies al cliente, y (para ORDER_NEW) 2x órdenes
  //    insertadas. Validamos contra wa_message_id que Meta garantiza único
  //    por mensaje inbound.
  if (messageId) {
    const { data: existing } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('wa_message_id', messageId)
      .maybeSingle();
    if (existing) {
      // Already processed — silent skip (don't log as error).
      return;
    }
  }

  // 1. Identify tenant
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('wa_phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .single();

  if (!tenant) {
    console.warn('Tenant no encontrado para:', phoneNumberId);
    return;
  }

  // 1.5. Conversation lock — serializa el procesamiento de mensajes del mismo
  // (tenant, paciente). Sin esto, dos webhooks paralelos pueden disparar dos
  // pipelines simultáneos y crear citas duplicadas (carrera entre hasConflict
  // checks). Si no se obtiene el lock, otro pipeline ya está corriendo —
  // dejamos que él procese (Meta reintentará si nada se persiste).
  const lock = await acquireConversationLock(tenant.id as string, senderPhone);
  if (!lock.acquired) {
    console.info('[processor] conversation locked, skipping concurrent message:', maskPhone(senderPhone));
    return;
  }

  try {
    await handleSingleMessageInner(msg, metadata, tenant as TenantRecord, senderPhone, phoneNumberId, messageId);
  } finally {
    if (lock.token) {
      await releaseConversationLock(tenant.id as string, senderPhone, lock.token).catch(() => {});
    }
  }
}

async function handleSingleMessageInner(
  msg: WhatsAppMessage,
  _metadata: { phone_number_id: string; display_phone_number: string },
  tenant: TenantRecord,
  senderPhone: string,
  phoneNumberId: string,
  messageId: string | undefined,
) {
  // 2. Gate checks
  if (!(await checkGates(tenant, senderPhone, phoneNumberId))) return;

  // 3. Mark as read (non-critical)
  if (messageId) {
    await markAsRead(phoneNumberId, messageId).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.error('markAsRead failed:', err);
    });
  }

  // 4. Extract content
  const extracted = await extractContentAsync(msg, tenant.id);
  const { content, messageType, mediaTranscription, mediaDescription } = extracted;
  if (!content || content.length < 1) return;

  // 5. Upsert contact
  let { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id, name')
    .eq('tenant_id', tenant.id)
    .eq('phone', senderPhone)
    .single();

  if (!contact) {
    const { data: newContact } = await supabaseAdmin
      .from('contacts')
      .insert({
        tenant_id: tenant.id,
        phone: senderPhone,
        name: msg.contacts?.[0]?.profile?.name || null,
      })
      .select('id, name')
      .single();
    contact = newContact;
  }

  // 6. Upsert conversation
  let { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, status, customer_name')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', senderPhone)
    .eq('channel', 'whatsapp')
    .single();

  const isNewConversation = !conv;

  if (!conv) {
    const { data: newConv } = await supabaseAdmin
      .from('conversations')
      .insert({
        tenant_id: tenant.id,
        contact_id: contact?.id,
        customer_phone: senderPhone,
        customer_name: contact?.name || null,
        channel: 'whatsapp',
      })
      .select('id, status, customer_name')
      .single();
    conv = newConv;
  }

  // Human handoff — save but don't respond
  if (conv?.status === 'human_handoff') {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conv.id,
      tenant_id: tenant.id,
      direction: 'inbound',
      sender_type: 'customer',
      content,
      message_type: messageType,
      wa_message_id: messageId,
    });
    return;
  }

  // 7. Save inbound message. Doble protección de idempotencia:
  //    - Check a nivel app (arriba, paso 0) — reject silent si ya existe
  //    - DB UNIQUE constraint en wa_message_id (si código 23505 → duplicate
  //      webhook retry simultáneo, safe to skip)
  const { error: insertErr } = await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'inbound',
    sender_type: 'customer',
    content,
    message_type: messageType,
    wa_message_id: messageId,
    media_type: ['audio', 'image', 'document', 'video'].includes(messageType) ? messageType : null,
    media_transcription: mediaTranscription || null,
    media_description: mediaDescription || null,
  });
  if (insertErr) {
    // PostgreSQL 23505 = unique_violation. Significa race con otro webhook
    // retry de Meta — el primer insert ganó, este es duplicado. No es error.
    if ((insertErr as { code?: string }).code === '23505') {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[processor] duplicate wa_message_id, skipping', { messageId });
      }
      return;
    }
    console.error('[processor] insert inbound message failed:', insertErr);
    // No retornamos — mejor intentar responder al cliente que silencio total
  }

  // 8. Welcome message for new conversations
  if (isNewConversation && tenant.welcome_message) {
    await sendTextMessage(phoneNumberId, senderPhone, tenant.welcome_message as string);
    await supabaseAdmin.from('messages').insert({
      conversation_id: conv!.id,
      tenant_id: tenant.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: tenant.welcome_message,
      message_type: 'text',
    });
    if (
      ['hola', 'hi', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches'].some((g) =>
        content.toLowerCase().includes(g),
      )
    ) {
      return;
    }
  }

  // 9. Classify intent (with state-machine override)
  const intent = await resolveIntent(content, conv!.id);

  // 10. Build RAG context + history in parallel
  const { ragContext, history } = await buildRagContext(tenant.id as string, content, conv!.id);

  // ───────────────────────────────────────────────────────────────────────────
  // 10b. PIPELINE FORK — tool calling vs. classifier (Fase 1)
  //
  // Si la env var global y el feature por-tenant están habilitados, el nuevo
  // orquestador toma el control desde aquí (envía la respuesta + persiste
  // mensajes + corre side effects). En cualquier otro caso seguimos con el
  // pipeline tradicional EXACTAMENTE como antes — esa rama no cambió.
  //
  // El ragContext ya construido se reaprovecha como contexto del system
  // prompt del orquestador para no perder el trabajo. El `intent` clasificado
  // por LLM no se usa en el orquestador (Fase 2 lo reemplazará por tool
  // routing nativo).
  // ───────────────────────────────────────────────────────────────────────────
  if (USE_TOOL_CALLING && tenantHasToolCallingEnabled(tenant)) {
    await handleWithOrchestrator({
      tenant: tenant as TenantRecord,
      conversationId: conv!.id,
      contactId: (contact?.id as string) || '',
      contactName: (contact?.name as string) || '',
      customerName: (conv?.customer_name as string) || (contact?.name as string) || '',
      phoneNumberId,
      senderPhone,
      ragContext,
      content,
      intent,
    });
    return;
  }

  // 11. Typing indicator (fire-and-forget)
  sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {});

  // 12. Generate and validate response
  const response = await generateAndValidateResponse({
    tenant: tenant as TenantRecord,
    intent,
    ragContext,
    history,
    customerName: contact?.name,
    content,
  });

  // 13. Send response via WhatsApp
  const finalText = appendMedicalDisclaimer(content, response.text);
  const { sendSmartResponse } = await import('@/lib/whatsapp/smart-response');
  await sendSmartResponse({
    phoneNumberId,
    to: senderPhone,
    text: finalText,
    intent,
    tenant: {
      name: tenant.name as string,
      phone: tenant.phone as string | undefined,
      lat: tenant.lat ? Number(tenant.lat) : undefined,
      lng: tenant.lng ? Number(tenant.lng) : undefined,
      address: tenant.address as string | undefined,
      business_type: tenant.business_type as string | undefined,
    },
  });

  // 14. Post-response side effects (best-effort)
  await runPostResponseEffects(
    tenant as TenantRecord,
    phoneNumberId,
    senderPhone,
    conv!.id,
    (contact?.id as string) || '',
    (contact?.name as string) || '',
    (conv?.customer_name as string) || (contact?.name as string) || '',
    intent,
    content,
  );

  // 15. Save outbound message + metrics
  await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: response.text,
    message_type: 'text',
    intent,
    model_used: response.model,
    tokens_in: response.tokensIn,
    tokens_out: response.tokensOut,
    cost_usd: response.cost,
    response_time_ms: response.responseTimeMs,
    confidence: response.confidence,
  });

  // 16. Update conversation timestamp
  await supabaseAdmin
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      customer_name: contact?.name || conv?.customer_name,
    })
    .eq('id', conv!.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// handleWithOrchestrator — nuevo pipeline (Fase 1)
//
// Reemplaza los pasos 11–16 del pipeline tradicional cuando el feature flag
// está activo para el tenant. Estructura intencionalmente simétrica a la
// rama clásica (typing → generar → enviar → side effects → guardar) para
// que sea trivial comparar comportamiento.
//
// En Fase 1 el registry de tools está vacío — el orquestador termina en 1
// LLM call sin tool execution. Esto valida el plumbing end-to-end sin
// cambiar el comportamiento aparente para el usuario más allá de "responde
// con grok en vez de gemini-flash".
// ─────────────────────────────────────────────────────────────────────────────
interface OrchestratorBranchArgs {
  tenant: TenantRecord;
  conversationId: string;
  contactId: string;
  contactName: string;
  customerName: string;
  phoneNumberId: string;
  senderPhone: string;
  ragContext: string;
  content: string;
  /** Intent del classifier — solo se pasa para post-response side effects. */
  intent: string;
}

async function handleWithOrchestrator(args: OrchestratorBranchArgs): Promise<void> {
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

  // 1. Typing indicator (fire-and-forget)
  sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {});

  // 2. Construir tenantCtx (Mexico TZ + fechas + servicios)
  const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);

  // ── FAST PATH 0: OPT-OUT (LFPDPPP compliance + WhatsApp policy) ─────────
  // Si el paciente responde STOP/BAJA, marcar contacts.opted_out=true.
  // Todos los crons (no-show, retention, etc.) filtran por opted_out=false.
  const optOutRegex = /^\s*(stop|baja|cancelar\s+suscripci[óo]n|d(é|e)me\s+de\s+baja|no\s+me\s+manden(\s+m[áa]s)?(\s+mensajes?)?|unsuscribe)\s*[.!]?\s*$/i;
  if (optOutRegex.test(content)) {
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

  // ── FAST PATH 0.5: OPT-IN (reactivar) ───────────────────────────────────
  if (/^\s*start\s*[.!]?\s*$/i.test(content) && contactId) {
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

  // 3a. FAST PATH — confirmación a recordatorio de cita.
  //     Sin este fast-path, el paciente que responde "sí voy" queda con
  //     confirmed_at=NULL porque el orchestrator no tiene la tool mark_confirmed
  //     registrada. Resultado: dashboard lo muestra como "en riesgo" cuando
  //     ya confirmó. El regex es conservador: solo mensajes que son claramente
  //     confirmación (no una pregunta que incluya "sí").
  const confirmRegex = /^\s*(s[ií]+|confirmo|confirmado|ah[íi]\s*(voy|estar[eé])|asisto|asistir[eé]|cuento\s*con(\s*usted)?|voy)\s*[.!]?\s*$/i;
  if (confirmRegex.test(content)) {
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

  // 3b. FAST PATH — antes de tocar el LLM, intenta resolver con regex
  const fastRoute = routeToAgent(content, tenantCtx);

  // 3a. URGENCIA: respuesta inmediata + escalación
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
    // Marcar conversación para handoff humano
    await supabaseAdmin
      .from('conversations')
      .update({
        status: 'human_handoff',
        tags: ['urgent', 'fast_path'],
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    // Notify owner (best effort)
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      await notifyOwner({
        tenantId: tenant.id,
        event: 'emergency',
        details: `Urgencia detectada por fast path:\n${senderPhone}\n"${content.slice(0, 200)}"`,
      });
    } catch {
      /* best effort */
    }
    return;
  }

  // 3b. FAQ: regex pattern → respuesta directa desde Supabase, sin LLM
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
    // FAQ regex matchó pero handler retornó null (data missing) → cae al LLM
  }

  // 4. Cargar historial conversacional
  const history = await getConversationContext(conversationId, 20);

  // 5. Componer messages: history + último mensaje del usuario
  const orchestratorMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content },
  ];

  // 6. AGENTE: Phase 2.D usa AGENDA agent para todos los tenants con
  //    tool_calling activado. Phase 3 ramificará por business_type / intent.
  //    El orquestador delega directamente a AGENDA — sin paso intermedio
  //    de "decidir agente" (eso se inferiría con un LLM extra que no aporta
  //    valor en MVP de salud/estética).
  const agentName: 'agenda' = 'agenda';
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

  // 6. Correr el orquestador. Si AMBOS modelos fallan, mostramos un mensaje
  //    fallback al cliente — nunca dejamos al usuario sin respuesta.
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
    if (err instanceof RateLimitError) {
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

  // Aplicar disclaimer médico si el mensaje del paciente contiene
  // patrones de auto-diagnóstico (segunda capa anti-alucinación).
  responseText = appendMedicalDisclaimer(content, responseText);

  // 7. Enviar la respuesta al cliente vía WhatsApp
  await sendTextMessage(phoneNumberId, senderPhone, responseText);

  // 8. Persistir el mensaje outbound + métricas (mismo schema que la rama clásica)
  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: responseText,
    message_type: 'text',
    intent: `orchestrator.${agentName}`,
    model_used: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
    response_time_ms: responseTimeMs,
    confidence: fallbackUsed ? 0.7 : 0.9,
  });

  // 9. Registrar tool calls ejecutadas (Fase 1: típicamente 0 calls, pero la
  //    instrumentación queda lista para Fase 2). Best-effort — un fallo en
  //    auditoría no debe afectar al cliente.
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

  // 10. Side effects post-respuesta — mismo runPostResponseEffects que la
  //     rama clásica. Esto mantiene lead-scoring, industry-actions, hot lead
  //     routing, owner notifications. Phase 2 podrá moverlos como tools.
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

  // 11. Update conversation timestamp (idéntico a la rama clásica)
  await supabaseAdmin
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      customer_name: contactName || customerName,
    })
    .eq('id', conversationId);
}
