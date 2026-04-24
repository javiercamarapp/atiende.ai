import { supabaseAdmin } from '@/lib/supabase/admin';
import { waitUntil } from '@vercel/functions';
import { sendTextMessage, markAsRead, sendTypingIndicator } from '@/lib/whatsapp/send';
// transcribeAudio moved to content-extraction.ts
import { resolveIntent } from '@/lib/whatsapp/classifier';
import { buildRagContext } from '@/lib/whatsapp/rag-context';
import { generateAndValidateResponse } from '@/lib/whatsapp/response-builder';
// orchestrator imports moved to orchestrator-branch.ts
import {
  ensureToolsRegistered,
  initializeAllAgents,
} from '@/lib/agents';

// ensureToolsRegistered() es FAIL-FAST al boot — si el code-splitting de
// Vercel dejó algún módulo de agente sin cargar, el proceso crashea aquí
// en vez de atender al primer paciente con tools faltantes (que devolvería
// "Tool not registered" al LLM y respuestas alucinadas).
// initializeAllAgents se mantiene para logging histórico.
try {
  ensureToolsRegistered();
} catch (err) {
  // En producción queremos fail-fast; en dev/test solo loguear para no
  // romper `vitest` si los side-effect imports corren en orden distinto.
  if (process.env.NODE_ENV === 'production') throw err;
  logger.error('[processor] ensureToolsRegistered failed', undefined, { err: err instanceof Error ? err.message : err });
}
void initializeAllAgents;
// AGENT_REGISTRY moved to orchestrator-branch.ts
import { appendMedicalDisclaimer, pickFallback } from '@/lib/guardrails/validate';
import { trackFallback } from '@/lib/monitoring';
import {
  acquireConversationLock,
  releaseConversationLock,
} from '@/lib/whatsapp/conversation-lock';
import { maskPhone } from '@/lib/utils/logger';
import { logger } from '@/lib/logger';
import { encryptPII, assertEncryptionConfigured } from '@/lib/utils/crypto';

// Fail-fast CHECK (lazy, se dispara en la primera request real, NO en el
// build de Next). Una vez arrancado el pipeline, si la assertion pasa una
// vez, no se vuelve a ejecutar. encryptPII() sigue siendo resiliente
// por-llamada (nunca throws) para no matar waitUntil.
let _encCheckDone = false;
function ensureEncryptionAtRequestTime(): void {
  if (_encCheckDone) return;
  _encCheckDone = true;
  try {
    assertEncryptionConfigured();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[processor] CRITICAL: encryption assert failed', undefined, { err: err instanceof Error ? err.message : err });
      throw err;
    }
    logger.warn('[processor] encryption assert warning', { err: err instanceof Error ? err.message : err });
  }
}
import { detectPromptInjection, sanitizeUserInput, sanitizeRagContext } from '@/lib/whatsapp/input-guardrail';
import { extractContentAsync, type WhatsAppMessage, type ExtractedContent } from './content-extraction';
import { runPostResponseEffects, type TenantRecord } from './side-effects';
import { handleWithOrchestrator } from './orchestrator-branch';

/**
 * Error indicativo "procesar después, no silenciar". Caller (QStash worker)
 * retorna 500 para triggerar retry. waitUntil lo atrapa y loggea.
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

import { EXTRACT_CONTENT_TIMEOUT_MS } from '@/lib/config';

// truncateHistoryByTokens + safeUserMessage moved to orchestrator-branch.ts

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

// WhatsAppMessage now imported from ./content-extraction

// TenantRecord now imported from ./side-effects

export async function processIncomingMessage(body: WhatsAppWebhookBody) {
  ensureEncryptionAtRequestTime();
  const tasks: Promise<void>[] = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value.messages) continue;
      for (const msg of value.messages) {
        tasks.push(handleSingleMessage(msg, value.metadata));
      }
    }
  }
  // Process messages concurrently. The conversation lock serializes
  // messages from the same (tenant, phone) pair; distinct senders
  // proceed in parallel instead of blocking each other sequentially.
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      if (r.reason instanceof ConversationLockedError) throw r.reason;
      logger.error('[processor] message handling failed', undefined, {
        err: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }
}

// -- Gate checks (rate limits, plan, business hours) --
// Extraído a src/lib/whatsapp/gates.ts.
// El processor ya no tiene lógica de puerta; solo delega.
import { runGates } from '@/lib/whatsapp/gates';

async function checkGates(
  tenant: TenantRecord,
  senderPhone: string,
  phoneNumberId: string,
): Promise<boolean> {
  return runGates(tenant, senderPhone, phoneNumberId);
}

// Content extraction → ./content-extraction.ts
// Side effects → ./side-effects.ts


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
    // Si la DB responde error (transient connection, RLS misconfig), antes
    // lo silenciábamos y procedíamos — potencial desperdicio de compute si
    // era un duplicado no detectable. Ahora loguamos pero seguimos: la
    // UNIQUE constraint en wa_message_id + atomicInboundUpsert es la
    // autoridad final (fail-closed en su propia capa).
    if (idempErr) {
      logger.warn('[processor] idempotency check DB error — continuing; UNIQUE constraint will catch duplicates', {  err: idempErr.message  });
    }
    if (existing) {
      // Already processed — silent skip (don't log as error).
      return;
    }
  }

  // 1. Identify tenant — buscamos primero SIN filtro de status para poder
  // dar respuesta amigable si está inactivo.
  // .single() falla con PGRST116 si hay duplicados. La migración
  // tenants_wa_unique.sql agrega UNIQUE constraint para prevenir que esto
  // ocurra. Si aun así pasa, loggear explícitamente para alerting.
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
      logger.error('[processor] CRITICAL: multiple tenants share wa_phone_number_id', undefined, {  count: dupCheck.length, phoneNumberId, tenantIds: dupCheck.map((t) => t.id)  });
      // Intenta registrar como error crítico (fallback Sentry + Supabase)
      try {
        const { captureError } = await import('@/lib/observability/error-tracker');
        await captureError(
          new Error(`Duplicate wa_phone_number_id: ${phoneNumberId}`),
          { route: 'processor.tenant_resolve', phone: phoneNumberId },
          'fatal',
        );
      } catch (err) {
        logger.error('[processor] captureError failed on duplicate tenant:', undefined, { err: err instanceof Error ? err.message : err });
      }
    }
    return;
  }

  if (!tenant) {
    logger.warn('[processor] tenant not found for phone_number_id', { phoneNumberId });
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
    } catch (err) {
      logger.warn('[processor] inactive-tenant notice send failed:', { err: err instanceof Error ? err.message : err });
    }
    return;
  }

  // 1.5. Conversation lock — serializa el procesamiento de mensajes del mismo
  // (tenant, paciente). Sin esto, dos webhooks paralelos pueden disparar dos
  // pipelines simultáneos y crear citas duplicadas (carrera entre hasConflict
  // checks). Si no se obtiene el lock, otro pipeline ya está corriendo —
  // dejamos que él procese (Meta reintentará si nada se persiste).
  const lock = await acquireConversationLock(tenant.id as string, senderPhone);
  if (!lock.acquired) {
    // Antes hacíamos `return` silencioso → el mensaje se perdía. Ahora
    // lanzamos error para que:
    //   - QStash worker retorne 500 y reintente con backoff
    //   - Si está en waitUntil, el catch del route maneja el throw
    // El lock tiene TTL 30s; el segundo intento de QStash (5s después) ya
    // encontrará el lock liberado.
    logger.info('[processor] conversation locked, rejecting for retry', { phone: maskPhone(senderPhone) });
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
      if (process.env.NODE_ENV !== 'production') {
        logger.error('[processor] markAsRead failed', undefined, { err: err instanceof Error ? err.message : err });
      }
    });
  }

  // 4. Extract content
  // Timeout global sobre extractContentAsync para evitar que
  // Whisper/Gemini colgados bloqueen el waitUntil hasta que Vercel mate la
  // función con 504. Si la extracción tarda >25s, fallback a un placeholder
  // y seguimos adelante (mensaje ya está idempotente-checked y el inbound
  // se persistirá; el LLM tratará el placeholder).
  // AbortController propagado para que las HTTP requests a
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
    logger.warn('[processor] media extraction failed — using placeholder:', { err: err instanceof Error ? err.message : err });
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
  // Sanitize + block prompt-injection ANTES del LLM. Si el mensaje
  // claramente intenta romper el system prompt, respondemos con un texto
  // cordial y NO consumimos LLM ni guardamos historial.
  const content = sanitizeUserInput(extracted.content);
  if (detectPromptInjection(content)) {
    logger.warn('[security] prompt injection blocked', {  phone: maskPhone(senderPhone)  });
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Lo siento, no puedo procesar ese mensaje. ¿En qué le puedo ayudar con su cita?',
    );
    return;
  }
  if (!content || content.length < 1) {
    // Rollback: reservamos un slot en checkGates pero no
    // vamos a consumir (no hay contenido procesable, no se envía respuesta).
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch (err) {
      logger.warn('[processor] release monthly (empty content) failed:', { err: err instanceof Error ? err.message : err });
    }
    return;
  }

  // 5-7. Atomic upsert (contact + conversation + inbound message).
  // Antes teníamos 3 INSERTs secuenciales sin transacción — si fallaba a
  // la mitad (DB flap, RLS, connection loss), rows huérfanas.
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
    logger.error('[processor] atomic upsert aborted', undefined, { err: upsertResult.errorMessage });
    await sendTextMessage(
      phoneNumberId,
      senderPhone,
      'Tuvimos un problema técnico. Por favor intente de nuevo en un momento.',
    ).catch((err) => {
      logger.warn('[processor] send technical-error notice failed:', { err: err instanceof Error ? err.message : err });
    });
    return;
  }

  // Webhook duplicado (UNIQUE en wa_message_id). El original ya se procesó.
  if (upsertResult.wasDuplicateWebhook) {
    if (process.env.NODE_ENV !== 'production') {
      logger.info('[processor] duplicate wa_message_id, skipping', { messageId });
    }
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch (err) {
      logger.warn('[processor] release monthly (dup webhook) failed:', { err: err instanceof Error ? err.message : err });
    }
    return;
  }

  // Human handoff — mensaje ya guardado por la RPC, solo salimos sin responder.
  if (conv?.status === 'human_handoff') {
    try {
      const { releaseMonthlyReservation } = await import('@/lib/rate-limit-monthly');
      await releaseMonthlyReservation(tenant.id as string);
    } catch (err) {
      logger.warn('[processor] release monthly (handoff) failed:', { err: err instanceof Error ? err.message : err });
    }
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
  const { ragContext: rawRagContext, history } = await buildRagContext(tenant.id as string, content, conv!.id);
  const ragContext = sanitizeRagContext(rawRagContext);

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
  // waitUntil evita que Vercel mate la HTTP request al regresar el handler
  // — sin esto, si la respuesta principal termina antes de que Meta reciba
  // el typing POST, el runtime puede cortarlo.
  waitUntil(sendTypingIndicator(phoneNumberId, senderPhone).catch(() => {}));

  // 12. Generate and validate response
  //
  // response-builder.ts ya tiene try/catch con fallback interno por intent,
  // así que este catch es el último safety-net: si algo INESPERADO (ej.
  // import dinámico roto, OOM, typo en env var) lanza antes del fallback
  // interno, seguimos contestando al cliente en vez de dejar silencio.
  let response: Awaited<ReturnType<typeof generateAndValidateResponse>>;
  try {
    response = await generateAndValidateResponse({
      tenant: tenant as TenantRecord,
      intent,
      ragContext,
      history,
      customerName: contact?.name,
      content,
    });
  } catch (err) {
    logger.error('[processor] generateAndValidateResponse threw unexpectedly', undefined, {
      intent,
      tenantId: tenant.id,
      err: err instanceof Error ? err.message : String(err),
    });
    trackFallback('processor_last_resort', tenant.id as string);
    const fallbackText = intent === 'GREETING' && tenant.welcome_message
      ? (tenant.welcome_message as string)
      : pickFallback(intent);
    response = {
      text: fallbackText,
      model: 'fallback',
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      responseTimeMs: 0,
      confidence: 0,
    };
  }

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

  // El contador mensual se PRE-RESERVA en checkGates
  // (reserveMonthlyMessage). Ya no incrementamos aquí — si llegamos hasta
  // este punto el slot ya fue contado. El rollback en caso de error se hace
  // en el catch del caller (handleSingleMessageInner) vía
  // releaseMonthlyReservation.

  // Métricas per-tenant para dashboard.
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
  } catch (err) {
    logger.warn('[processor] emit metrics failed:', { err: err instanceof Error ? err.message : err });
  }

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
