import { supabaseAdmin } from '@/lib/supabase/admin';
import { waitUntil } from '@vercel/functions';
import { sendTextMessage, markAsRead, sendTypingIndicator } from '@/lib/whatsapp/send';
import { transcribeAudio } from '@/lib/voice/deepgram';
import { resolveIntent } from '@/lib/whatsapp/classifier';
import { buildRagContext } from '@/lib/whatsapp/rag-context';
import { generateAndValidateResponse } from '@/lib/whatsapp/response-builder';
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
  ensureToolsRegistered,
  initializeAllAgents,
} from '@/lib/agents';

// FIX 3 (audit R4): ensureToolsRegistered() es FAIL-FAST al boot — si el
// code-splitting de Vercel dejó algún módulo de agente sin cargar, el
// proceso crashea aquí en vez de atender al primer paciente con tools
// faltantes (que devolvería "Tool not registered" al LLM y respuestas
// alucinadas). initializeAllAgents se mantiene para logging histórico.
try {
  ensureToolsRegistered();
} catch (err) {
  // En producción queremos fail-fast; en dev/test solo loguear para no
  // romper `vitest` si los side-effect imports corren en orden distinto.
  if (process.env.NODE_ENV === 'production') throw err;
  console.error('[processor]', err instanceof Error ? err.message : err);
}
void initializeAllAgents;
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { appendMedicalDisclaimer } from '@/lib/guardrails/validate';
import {
  acquireConversationLock,
  releaseConversationLock,
} from '@/lib/whatsapp/conversation-lock';
import { maskPhone, redactHistoryForLLM } from '@/lib/utils/logger';
import { encryptPII, assertEncryptionConfigured } from '@/lib/utils/crypto';

// AUDIT-R5 MEDIO: fail-fast CHECK (lazy, se dispara en la primera request
// real, NO en el build de Next). Una vez arrancado el pipeline, si la
// assertion pasa una vez, no se vuelve a ejecutar. encryptPII() sigue
// siendo resiliente por-llamada (nunca throws) para no matar waitUntil.
let _encCheckDone = false;
function ensureEncryptionAtRequestTime(): void {
  if (_encCheckDone) return;
  _encCheckDone = true;
  try {
    assertEncryptionConfigured();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[processor] CRITICAL:', err instanceof Error ? err.message : err);
      throw err;
    }
    console.warn('[processor]', err instanceof Error ? err.message : err);
  }
}
import { detectPromptInjection, sanitizeUserInput } from '@/lib/whatsapp/input-guardrail';
import * as mediaProcessor from '@/lib/whatsapp/media-processor';

/**
 * AUDIT-R10 MED: error indicativo "procesar después, no silenciar".
 * Caller (QStash worker) retorna 500 para triggerar retry. waitUntil
 * lo atrapa y loggea.
 */
export class ConversationLockedError extends Error {
  constructor(public readonly phone: string) {
    super(`Conversation lock held for ${phone} — retry recommended`);
    this.name = 'ConversationLockedError';
  }
}

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

import { MAX_USER_INPUT_CHARS, HISTORY_MAX_MESSAGES, HISTORY_MAX_TOKENS, EXTRACT_CONTENT_TIMEOUT_MS } from '@/lib/config';

function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, MAX_USER_INPUT_CHARS);
}

// BUG 7 FIX + AUDIT R18: presupuesto por TOKENS ESTIMADOS (no chars puros)
// para el historial que mandamos al LLM. Con 40 mensajes largos (audio +
// imágenes + PDFs transcritos) se puede desbordar la ventana de Grok; cuando
// pasa, el modelo trunca el tool_call a la mitad y falla el orquestador.
//
// Antes usábamos content.length (chars). Problema: emojis y español con
// acentos compuestos inflan tokens vs chars, metiendo edge cases de
// overflow. Ahora usamos estimateTokens() conservador (3 chars/token) que
// da 15-25% de safety buffer.
//
// Conserva SIEMPRE los últimos `keepRecent` turnos (contexto inmediato) y
// agrega más antiguos mientras quepan en `maxTokens`.
//
// AUDIT-R5 BAJO: también colapsa reacciones consecutivas (mismo emoji y/o
// múltiples [Reacción ...] seguidos) en una sola entrada para no desperdiciar
// tokens. Las reacciones son señal UX, no contexto semántico para el LLM.
import { estimateTokens } from '@/lib/utils/token-estimate';

function truncateHistoryByTokens<T extends { content: string }>(
  messages: T[],
  maxTokens: number,
  keepRecent = 5,
): T[] {
  // Paso 0: colapsar reacciones consecutivas.
  const collapsed: T[] = [];
  for (const m of messages) {
    const isReaction = /^\[Reacci[oó]n\b/.test(m.content || '');
    const prev = collapsed[collapsed.length - 1];
    const prevIsReaction = prev && /^\[Reacci[oó]n\b/.test(prev.content || '');
    if (isReaction && prevIsReaction) {
      // ya tenemos una reacción previa — saltamos (colapsamos)
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

// SEC-1: Wrapper que aplica el guardrail anti-prompt-injection además de
// la sanitización HTML. Usado al construir el mensaje para el LLM.
import { guardUserInput } from '@/lib/guardrails/input-guard';
function safeUserMessage(raw: string): { content: string; flagged: boolean } {
  const cleaned = sanitizeInput(raw);
  const guard = guardUserInput(cleaned);
  if (guard.flagged) {
    console.warn('[guardrail] prompt injection patterns:', guard.reasons.slice(0, 3));
  }
  return { content: guard.sanitized, flagged: guard.flagged };
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
  ensureEncryptionAtRequestTime();
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
// Extraído a src/lib/whatsapp/gates.ts (AUDIT R14 refactor).
// El processor ya no tiene lógica de puerta; solo delega.
import { runGates } from '@/lib/whatsapp/gates';

async function checkGates(
  tenant: TenantRecord,
  senderPhone: string,
  phoneNumberId: string,
): Promise<boolean> {
  return runGates(tenant, senderPhone, phoneNumberId);
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
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  switch (msg.type) {
    case 'text':
      return { content: sanitizeInput(msg.text?.body || ''), messageType: 'text' };

    case 'audio':
    case 'voice': {
      const id = msg.audio?.id || msg.voice?.id;
      if (!id) return { content: '[Audio no disponible]', messageType: 'audio' };
      const r = await mediaProcessor.transcribeAudio(id, tenantId, signal);
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
      const r = await mediaProcessor.describeImage(msg.image.id, tenantId, msg.image.caption, signal);
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
      const r = await mediaProcessor.extractPdfText(msg.document.id, tenantId, msg.document.filename, signal);
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
    const { data: existing, error: idempErr } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('wa_message_id', messageId)
      .maybeSingle();
    // AUDIT R17 BUG-030: si la DB responde error (transient connection, RLS
    // misconfig), antes lo silenciábamos y procedíamos — potencial
    // desperdicio de compute si era un duplicado no detectable. Ahora
    // loguamos pero seguimos: la UNIQUE constraint en wa_message_id +
    // atomicInboundUpsert es la autoridad final (fail-closed en su propia
    // capa).
    if (idempErr) {
      console.warn(
        '[processor] idempotency check DB error — continuing; UNIQUE constraint will catch duplicates:',
        idempErr.message,
      );
    }
    if (existing) {
      // Already processed — silent skip (don't log as error).
      return;
    }
  }

  // 1. Identify tenant — buscamos primero SIN filtro de status para poder
  // dar respuesta amigable si está inactivo (FIX 6 audit Round 2).
  // AUDIT R12 BUG-001: .single() falla con PGRST116 si hay duplicados. La
  // migración tenants_wa_unique.sql agrega UNIQUE constraint para prevenir
  // que esto ocurra. Si aun así pasa, loggear explícitamente para alerting.
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('wa_phone_number_id', phoneNumberId)
    .single();

  if (tenantErr && tenantErr.code === 'PGRST116') {
    // Múltiples tenants o ninguno — investigar cuál caso.
    const { data: dupCheck } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('wa_phone_number_id', phoneNumberId);
    if (dupCheck && dupCheck.length > 1) {
      console.error(
        `[processor] CRITICAL: ${dupCheck.length} tenants comparten wa_phone_number_id=${phoneNumberId}. IDs:`,
        dupCheck.map((t) => t.id),
      );
      // Intenta registrar como error crítico (fallback Sentry + Supabase)
      try {
        const { captureError } = await import('@/lib/observability/error-tracker');
        await captureError(
          new Error(`Duplicate wa_phone_number_id: ${phoneNumberId}`),
          { route: 'processor.tenant_resolve', phone: phoneNumberId },
          'fatal',
        );
      } catch { /* no-op */ }
    }
    return;
  }

  if (!tenant) {
    console.warn('Tenant no encontrado para:', phoneNumberId);
    return;
  }

  // 1.1 Tenant inactivo (suspendido / trial expirado / pausado): contestar
  // un mensaje cordial en vez de silencio total — la peor UX es no recibir
  // respuesta del consultorio.
  if (tenant.status !== 'active') {
    try {
      await sendTextMessage(
        phoneNumberId,
        senderPhone,
        'Gracias por contactarnos. En este momento nuestro servicio no está disponible. Por favor intente más tarde o contáctenos directamente.',
      );
    } catch { /* best effort */ }
    return;
  }

  // 1.5. Conversation lock — serializa el procesamiento de mensajes del mismo
  // (tenant, paciente). Sin esto, dos webhooks paralelos pueden disparar dos
  // pipelines simultáneos y crear citas duplicadas (carrera entre hasConflict
  // checks). Si no se obtiene el lock, otro pipeline ya está corriendo —
  // dejamos que él procese (Meta reintentará si nada se persiste).
  const lock = await acquireConversationLock(tenant.id as string, senderPhone);
  if (!lock.acquired) {
    // AUDIT-R10 MED: antes hacíamos `return` silencioso → el mensaje se perdía.
    // Ahora lanzamos error para que:
    //   - QStash worker retorne 500 y reintente con backoff
    //   - Si está en waitUntil, el catch del route maneja el throw
    // El lock tiene TTL 30s; el segundo intento de QStash (5s después) ya
    // encontrará el lock liberado.
    console.info('[processor] conversation locked, rejecting for retry:', maskPhone(senderPhone));
    throw new ConversationLockedError(senderPhone);
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
  // AUDIT-R5 ALTO: timeout global sobre extractContentAsync para evitar
  // que Whisper/Gemini colgados bloqueen el waitUntil hasta que Vercel
  // mate la función con 504. Si la extracción tarda >25s, fallback a
  // un placeholder y seguimos adelante (mensaje ya está idempotente-checked
  // y el inbound se persistirá; el LLM tratará el placeholder).
  // AUDIT-R10 MED: AbortController propagado para que las HTTP requests a
  // Deepgram/Whisper/Gemini se CANCELEN al timeout — sin esto quedaban
  // dangling en memoria consumiendo compute serverless.
  const extractAbort = new AbortController();
  let extracted: ExtractedContent;
  try {
    extracted = await Promise.race([
      extractContentAsync(msg, tenant.id, extractAbort.signal),
      new Promise<never>((_, rej) =>
        setTimeout(() => {
          extractAbort.abort(); // cancela las HTTP reales
          rej(new Error(`extractContentAsync timeout after ${EXTRACT_CONTENT_TIMEOUT_MS}ms`));
        }, EXTRACT_CONTENT_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    console.warn('[processor] media extraction failed — using placeholder:', err instanceof Error ? err.message : err);
    extracted = {
      content: msg.type === 'audio' || msg.type === 'voice'
        ? '[Audio que no pude procesar. ¿Puede escribirlo?]'
        : msg.type === 'image'
        ? '[Imagen que no pude analizar]'
        : msg.type === 'document'
        ? '[Documento que no pude leer]'
        : `[${msg.type} no procesado]`,
      messageType: msg.type,
    };
  }
  const { messageType, mediaTranscription, mediaDescription } = extracted;
  // FIX 2 (audit Round 2): sanitize + block prompt-injection ANTES del LLM.
  // Si el mensaje claramente intenta romper el system prompt, respondemos
  // con un texto cordial y NO consumimos LLM ni guardamos historial.
  const content = sanitizeUserInput(extracted.content);
  if (detectPromptInjection(content)) {
    console.warn(
      '[security] prompt injection blocked from:',
      maskPhone(senderPhone),
    );
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Lo siento, no puedo procesar ese mensaje. ¿En qué le puedo ayudar con su cita?',
    );
    return;
  }
  if (!content || content.length < 1) {
    // AUDIT R14 BUG-002 rollback: reservamos un slot en checkGates pero no
    // vamos a consumir (no hay contenido procesable, no se envía respuesta).
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch { /* no-op */ }
    return;
  }

  // 5-7. Atomic upsert (contact + conversation + inbound message).
  // AUDIT R14 BUG-001: antes teníamos 3 INSERTs secuenciales sin transacción
  // — si fallaba a la mitad (DB flap, RLS, connection loss), rows huérfanas.
  // atomicInboundUpsert usa un RPC plpgsql (ACID rollback automático) y
  // cae a path legacy idempotente si la migración aún no está aplicada.
  const { atomicInboundUpsert } = await import('@/lib/whatsapp/inbound-upsert');
  const upsertResult = await atomicInboundUpsert({
    tenantId: tenant.id as string,
    senderPhone,
    contactName: msg.contacts?.[0]?.profile?.name || null,
    waMessageId: messageId,
    content,
    messageType,
    mediaTranscription: mediaTranscription || null,
    mediaDescription: mediaDescription || null,
  });

  // Shape-compatible variables para no tocar el código downstream (welcome
  // message, handleWithOrchestrator, etc. esperan contact y conv).
  const contact: { id: string; name: string | null } | null = upsertResult.contactId
    ? { id: upsertResult.contactId, name: upsertResult.contactName }
    : null;
  const conv: { id: string; status: string | null; customer_name: string | null } | null =
    upsertResult.conversationId
      ? {
          id: upsertResult.conversationId,
          status: upsertResult.convStatus,
          customer_name: upsertResult.contactName,
        }
      : null;
  const isNewConversation = upsertResult.isNewConversation;

  // Caso error crítico (DB caída, RLS mal): abortamos para no desincronizar
  // historial. Meta reintentará (somos idempotentes).
  if (upsertResult.aborted) {
    console.error('[processor] atomic upsert aborted:', upsertResult.errorMessage);
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Tuvimos un problema técnico. Por favor intente de nuevo en un momento.',
    ).catch(() => { /* best effort */ });
    return;
  }

  // Webhook duplicado (UNIQUE en wa_message_id). El original ya se procesó.
  if (upsertResult.wasDuplicateWebhook) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[processor] duplicate wa_message_id, skipping', { messageId });
    }
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch { /* no-op */ }
    return;
  }

  // Human handoff — mensaje ya guardado por la RPC, solo salimos sin responder.
  if (conv?.status === 'human_handoff') {
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch { /* no-op */ }
    return;
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
  // AUDIT R14 BUG-030: waitUntil evita que Vercel mate la HTTP request al
  // regresar el handler — sin esto, si la respuesta principal termina antes
  // de que Meta reciba el typing POST, el runtime puede cortarlo.
  waitUntil(sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {}));

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

  // 15. Save outbound message + metrics (PRIV-2: cifrado at-rest)
  await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: tenant.id,
    direction: 'outbound',
    sender_type: 'bot',
    content: encryptPII(response.text),
    message_type: 'text',
    intent,
    model_used: response.model,
    tokens_in: response.tokensIn,
    tokens_out: response.tokensOut,
    cost_usd: response.cost,
    response_time_ms: response.responseTimeMs,
    confidence: response.confidence,
  });

  // AUDIT R14 BUG-002: el contador mensual se PRE-RESERVA en checkGates
  // (reserveMonthlyMessage). Ya no incrementamos aquí — si llegamos hasta
  // este punto el slot ya fue contado. El rollback en caso de error se hace
  // en el catch del caller (handleSingleMessageInner) vía
  // releaseMonthlyReservation.

  // AUDIT R13: métricas per-tenant para dashboard.
  try {
    const { emit, cost } = await import('@/lib/observability/metrics');
    emit({
      name: 'message.processed',
      value: 1,
      unit: 'count',
      tenantId: tenant.id as string,
      tags: { intent, model: response.model },
    });
    emit({
      name: 'llm.latency',
      value: response.responseTimeMs,
      unit: 'ms',
      tenantId: tenant.id as string,
      tags: { model: response.model },
    });
    if (response.cost) cost(response.cost, tenant.id as string, response.model);
  } catch { /* no-op */ }

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
  // AUDIT R14 BUG-030: wrap en waitUntil para que el runtime serverless
  // mantenga viva la petición aunque el handler principal termine antes.
  waitUntil(sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {}));

  // 2. Construir tenantCtx (Mexico TZ + fechas + servicios)
  const tenantCtx = buildTenantContext(tenant as unknown as Record<string, unknown>);

  // ── FAST PATH 0: OPT-OUT (LFPDPPP compliance + WhatsApp policy) ─────────
  // Si el paciente responde STOP/BAJA (o frases equivalentes), marcar
  // contacts.opted_out=true. Todos los crons filtran por opted_out=false.
  // BUG 5 FIX: regex flexible con \b (no anclado a ^$) para aceptar
  // "Quiero darme de baja por favor" o "Stop a estos mensajes". Guard de
  // longitud <150 chars evita falsos positivos en mensajes largos que
  // solo mencionan "baja" de pasada.
  // Fast-path opt-out (AUDIT R14: regex extraído a opt-out-regex.ts + tests)
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

  // ── FAST PATH 0.5: OPT-IN (reactivar) — también fuzzy por consistencia.
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

  // 3a. FAST PATH — confirmación a recordatorio de cita.
  //     Sin este fast-path, el paciente que responde "sí voy" queda con
  //     confirmed_at=NULL porque el orchestrator no tiene la tool mark_confirmed
  //     registrada. Resultado: dashboard lo muestra como "en riesgo" cuando
  //     ya confirmó. El regex es conservador: solo mensajes que son claramente
  //     confirmación (no una pregunta que incluya "sí").
  // AUDIT-R10 BAJO: regex flexible — antes requería que el mensaje fuera
  // EXACTAMENTE la palabra ("sí" sola). Ahora acepta "Sí voy, muchas
  // gracias!!!", "Confirmo mi cita, saludos" y similares.
  //
  // Estrategia: \b en los alternativos + length<120 para evitar falsos
  // positivos en mensajes largos donde "sí" aparece de pasada.
  // Además: el mensaje NO debe tener pregunta ("?" o palabras-pregunta) para
  // evitar interpretar "¿sí voy?" como confirmación.
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

  // 4. Cargar historial conversacional (MT-1: 40 mensajes en vez de 20).
  // BUG 7 FIX: presupuesto de caracteres para evitar que un historial con
  // audios transcritos + imágenes descritas + PDFs desborde la ventana de
  // contexto de Grok y trunque el tool_call a mitad. Siempre preservamos
  // los 5 últimos turnos (contexto inmediato) y agregamos más antiguos
  // hasta llegar al presupuesto.
  const rawHistory = await getConversationContext(conversationId, HISTORY_MAX_MESSAGES);
  const history = truncateHistoryByTokens(rawHistory, HISTORY_MAX_TOKENS);

  // 5. Componer messages: history + último mensaje del usuario
  // SEC-1: aplicamos guardrail anti-prompt-injection al último mensaje;
  // PRIV-6: enmascaramos PII en el historial antes de mandarlo al LLM.
  const safeMsg = safeUserMessage(content);
  const orchestratorMessages = [
    ...redactHistoryForLLM(history).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: safeMsg.content },
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
