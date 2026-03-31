import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, selectModel, calculateCost, MODELS } from '@/lib/llm/openrouter';
import { classifyIntent } from '@/lib/llm/classifier';
import { searchKnowledge } from '@/lib/rag/search';
import { validateResponse } from '@/lib/guardrails/validate';
import { sendTextMessage, markAsRead } from '@/lib/whatsapp/send';
import { transcribeAudio } from '@/lib/voice/deepgram';
import { checkRateLimit, checkTenantLimit } from '@/lib/rate-limit';

export async function processIncomingMessage(body: any) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Ignorar status updates (delivered, read, etc.)
      if (!value.messages) continue;

      for (const msg of value.messages) {
        await handleSingleMessage(msg, value.metadata);
      }
    }
  }
}

async function handleSingleMessage(
  msg: any,
  metadata: { phone_number_id: string; display_phone_number: string }
) {
  const senderPhone = msg.from; // numero del cliente
  const phoneNumberId = metadata.phone_number_id;
  const messageId = msg.id;

  // ═══ 1. IDENTIFICAR TENANT ═══
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

  // ═══ 1.5 RATE LIMITING ═══
  const rateLimited = await checkRateLimit(senderPhone);
  if (!rateLimited.allowed) {
    return; // silently drop if rate limited
  }

  const tenantLimited = await checkTenantLimit(tenant.id, tenant.plan);
  if (!tenantLimited.allowed) {
    return; // silently drop if tenant limit exceeded
  }

  // ═══ 2. MARCAR COMO LEIDO ═══
  await markAsRead(phoneNumberId, messageId).catch(() => {});

  // ═══ 3. EXTRAER CONTENIDO DEL MENSAJE ═══
  let content = '';
  let messageType = msg.type;

  switch (msg.type) {
    case 'text':
      content = msg.text.body;
      break;
    case 'audio':
      content = await transcribeAudio(msg.audio.id);
      messageType = 'audio';
      break;
    case 'image':
      content = msg.image.caption
        ? `[Imagen: ${msg.image.caption}]`
        : '[Imagen recibida]';
      break;
    case 'document':
      content = `[Documento: ${msg.document.filename || 'archivo'}]`;
      break;
    case 'location':
      content = `[Ubicacion: ${msg.location.latitude},${msg.location.longitude}]`;
      break;
    case 'interactive':
      if (msg.interactive?.type === 'button_reply') {
        content = msg.interactive.button_reply.title;
      } else if (msg.interactive?.type === 'list_reply') {
        content = msg.interactive.list_reply.title;
      }
      break;
    case 'sticker':
      content = '[Sticker]';
      break;
    default:
      content = `[${msg.type} recibido]`;
  }

  if (!content || content.length < 1) return;

  // ═══ 4. OBTENER O CREAR CONTACTO ═══
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

  // ═══ 5. OBTENER O CREAR CONVERSACION ═══
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

  // Si esta en human_handoff, NO responder con AI
  if (conv?.status === 'human_handoff') {
    // Solo guardar el mensaje, un humano respondera
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

  // ═══ 6. GUARDAR MENSAJE ENTRANTE ═══
  await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'inbound',
    sender_type: 'customer',
    content,
    message_type: messageType,
    wa_message_id: messageId,
  });

  // ═══ 7. ENVIAR BIENVENIDA SI ES PRIMER CONTACTO ═══
  if (isNewConversation && tenant.welcome_message) {
    await sendTextMessage(
      phoneNumberId, senderPhone, tenant.welcome_message
    );
    await supabaseAdmin.from('messages').insert({
      conversation_id: conv!.id,
      tenant_id: tenant.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: tenant.welcome_message,
      message_type: 'text',
    });
    // Si el welcome fue suficiente, no generar otra respuesta
    // para saludos simples
    if (['hola', 'hi', 'buenas', 'buen dia', 'buenos dias',
         'buenas tardes', 'buenas noches']
        .some(g => content.toLowerCase().includes(g))) {
      return;
    }
  }

  // ═══ 8. CLASIFICAR INTENT ═══
  const intent = await classifyIntent(content);

  // ═══ 9. BUSCAR CONTEXTO RAG ═══
  const ragContext = await searchKnowledge(tenant.id, content);

  // ═══ 10. OBTENER HISTORIAL (ultimos 8 mensajes) ═══
  const { data: history } = await supabaseAdmin
    .from('messages')
    .select('direction, sender_type, content')
    .eq('conversation_id', conv!.id)
    .order('created_at', { ascending: true })
    .limit(8);

  // ═══ 11. SELECCIONAR MODELO LLM ═══
  const model = selectModel(intent, tenant.business_type, tenant.plan);

  // ═══ 12. GENERAR RESPUESTA ═══
  const startTime = Date.now();

  const systemPrompt = buildSystemPrompt(tenant, ragContext, intent, contact?.name);

  const result = await generateResponse({
    model,
    system: systemPrompt,
    messages: (history || [])
      .filter(m => m.content)
      .map(m => ({
        role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content!,
      })),
    maxTokens: 400,
    temperature: tenant.temperature || 0.5,
  });

  const responseTime = Date.now() - startTime;

  // ═══ 13. VALIDAR ANTI-ALUCINACION ═══
  const validation = validateResponse(result.text, tenant, ragContext, content);
  const finalText = validation.valid ? validation.text : validation.text;

  // ═══ 14. ENVIAR RESPUESTA POR WHATSAPP ═══
  await sendTextMessage(phoneNumberId, senderPhone, finalText);

  // ═══ 15. GUARDAR MENSAJE SALIENTE + METRICAS ═══
  await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: finalText,
    message_type: 'text',
    intent,
    model_used: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.cost,
    response_time_ms: responseTime,
    confidence: validation.valid ? 0.9 : 0.3,
  });

  // ═══ 16. ACTUALIZAR CONVERSACION ═══
  await supabaseAdmin
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      customer_name: contact?.name || conv?.customer_name,
    })
    .eq('id', conv!.id);
}

// ═══ CONSTRUIR SYSTEM PROMPT ═══
function buildSystemPrompt(
  tenant: any, ragContext: string, intent: string, customerName?: string | null
): string {
  return `${tenant.chat_system_prompt || getDefaultPrompt(tenant)}

═══ CONTEXTO DEL NEGOCIO (usa SOLO esta informacion para responder) ═══
${ragContext}

═══ REGLAS DE ESTA RESPUESTA ═══
INTENT DETECTADO: ${intent}
${customerName ? `NOMBRE DEL CLIENTE: ${customerName}` : ''}
- Responde en MAXIMO 3-4 oraciones
- Si no tienes info: "Permitame verificar con el equipo"
- NUNCA inventes datos, precios, horarios
- Usa los precios EXACTOS del contexto
- Espanol mexicano, "usted" siempre`;
}

function getDefaultPrompt(tenant: any): string {
  return `Eres el asistente virtual de ${tenant.name}${tenant.address ? ` en ${tenant.address}` : ''}.
Hablas espanol mexicano natural. Usas "usted" siempre.
Eres calido, profesional y servicial.
Tu trabajo: informar sobre servicios, precios, horarios, y agendar citas.
Si no sabes algo: "Permitame verificar con el equipo y le confirmo."
NUNCA diagnostiques, recetes, ni des asesoria medica/legal.
Ofrece siempre: "Si prefiere hablar con una persona, con gusto le comunico."`;
}
