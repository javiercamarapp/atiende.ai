import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, markAsRead, sendTypingIndicator } from '@/lib/whatsapp/send';
import { transcribeAudio } from '@/lib/voice/deepgram';
import { checkRateLimit, checkTenantLimit } from '@/lib/rate-limit';
import { resolveIntent } from '@/lib/whatsapp/classifier';
import { buildRagContext } from '@/lib/whatsapp/rag-context';
import { generateAndValidateResponse } from '@/lib/whatsapp/response-builder';

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
  audio?: { id: string };
  image?: { caption?: string };
  document?: { filename?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: string;
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
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

  // 2. Gate checks
  if (!(await checkGates(tenant as TenantRecord, senderPhone, phoneNumberId))) return;

  // 3. Mark as read (non-critical)
  await markAsRead(phoneNumberId, messageId).catch((err) => {
    if (process.env.NODE_ENV !== 'production') console.error('markAsRead failed:', err);
  });

  // 4. Extract content
  const { content, messageType } = await extractContent(msg);
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

  // 7. Save inbound message
  await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'inbound',
    sender_type: 'customer',
    content,
    message_type: messageType,
    wa_message_id: messageId,
  });

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
  const { sendSmartResponse } = await import('@/lib/whatsapp/smart-response');
  await sendSmartResponse({
    phoneNumberId,
    to: senderPhone,
    text: response.text,
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
