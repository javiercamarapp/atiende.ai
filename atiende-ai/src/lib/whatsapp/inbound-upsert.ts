// ═════════════════════════════════════════════════════════════════════════════
// INBOUND UPSERT — helper atómico que respalda el pipeline con un RPC
//
// El processor hacía 3 INSERTs secuenciales sin transacción. Si fallaba
// a la mitad → rows huérfanas. Ya mitigábamos con find-before-insert +
// UNIQUE(wa_message_id), pero la red definitiva es usar una función plpgsql
// que corre todo en una transacción implícita.
//
// Este helper envuelve el RPC `upsert_inbound_message` con un fallback
// automático al camino legado (3 queries secuenciales) si:
//   - La migración atomic_inbound_upsert.sql no fue aplicada aún
//     (error PGRST202 "function not found")
//   - La variable env DISABLE_ATOMIC_UPSERT está activa (kill switch)
//
// Una vez que la migración esté aplicada en producción y no veamos errores
// durante 30 días, se puede borrar el fallback.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptPII } from '@/lib/utils/crypto';
import { encryptContactPhone, encryptContactName } from '@/lib/utils/pii-columns';

export interface InboundUpsertInput {
  tenantId: string;
  senderPhone: string;
  contactName: string | null;
  waMessageId?: string;
  content: string;
  messageType: string;
  mediaTranscription: string | null;
  mediaDescription: string | null;
}

export interface InboundUpsertResult {
  contactId: string;
  contactName: string | null;
  conversationId: string;
  convStatus: string | null;
  isNewConversation: boolean;
  messageInserted: boolean;
  wasDuplicateWebhook: boolean;
  /** 'rpc' si se usó la función atómica; 'legacy' si el fallback secuencial. */
  pathUsed: 'rpc' | 'legacy';
  /** `true` si algo falló catastróficamente (el caller debe abortar pipeline). */
  aborted?: boolean;
  /** Mensaje de error si aborted=true. */
  errorMessage?: string;
}

/**
 * Intenta el RPC atómico; cae al path legacy si falla.
 */
export async function atomicInboundUpsert(
  input: InboundUpsertInput,
): Promise<InboundUpsertResult> {
  if (process.env.DISABLE_ATOMIC_UPSERT !== 'true') {
    const rpcResult = await tryRpcPath(input);
    if (rpcResult) return rpcResult;
  }
  return legacyPath(input);
}

async function tryRpcPath(
  input: InboundUpsertInput,
): Promise<InboundUpsertResult | null> {
  const { data, error } = await supabaseAdmin.rpc('upsert_inbound_message', {
    p_tenant_id: input.tenantId,
    p_phone: input.senderPhone,
    p_contact_name: input.contactName,
    p_customer_phone: input.senderPhone,
    p_wa_message_id: input.waMessageId ?? null,
    p_content: encryptPII(input.content),
    p_message_type: input.messageType,
    p_media_transcription: encryptPII(input.mediaTranscription),
    p_media_description: encryptPII(input.mediaDescription),
  });

  if (error) {
    const code = (error as { code?: string }).code;
    // PGRST202 = function not found in the API schema cache. Migración no
    // aplicada aún — caemos al legacy path silenciosamente.
    if (code === 'PGRST202' || /function .* does not exist/i.test(error.message)) {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[inbound-upsert] RPC not deployed — falling back to legacy');
      }
      return null;
    }
    // Error real — abortamos pipeline (es fail-safe: prefer no procesar a
    // procesar con DB inconsistente).
    console.error('[inbound-upsert] RPC failed:', error.message);
    return {
      contactId: '',
      contactName: null,
      conversationId: '',
      convStatus: null,
      isNewConversation: false,
      messageInserted: false,
      wasDuplicateWebhook: false,
      pathUsed: 'rpc',
      aborted: true,
      errorMessage: error.message,
    };
  }

  const r = data as {
    contact_id: string;
    contact_name: string | null;
    conversation_id: string;
    conv_status: string | null;
    is_new_conversation: boolean;
    message_inserted: boolean;
    was_duplicate_webhook: boolean;
  };

  return {
    contactId: r.contact_id,
    contactName: r.contact_name,
    conversationId: r.conversation_id,
    convStatus: r.conv_status,
    isNewConversation: r.is_new_conversation,
    messageInserted: r.message_inserted,
    wasDuplicateWebhook: r.was_duplicate_webhook,
    pathUsed: 'rpc',
  };
}

/**
 * Path legacy: 3 queries secuenciales. Se mantiene para retrocompatibilidad
 * mientras la RPC se rollea en tenants existentes. Tras verificar en
 * producción, se puede eliminar.
 */
async function legacyPath(input: InboundUpsertInput): Promise<InboundUpsertResult> {
  // 1. Contact — lookup by blind index (phone_hash) if available, else plaintext
  const lookupHash = encryptContactPhone(input.senderPhone).hash;
  let contactQuery = supabaseAdmin
    .from('contacts')
    .select('id, name')
    .eq('tenant_id', input.tenantId);
  if (lookupHash) {
    contactQuery = contactQuery.eq('phone_hash', lookupHash);
  } else {
    contactQuery = contactQuery.eq('phone', input.senderPhone);
  }
  let { data: contact } = await contactQuery.single();

  if (!contact) {
    const phonePii = encryptContactPhone(input.senderPhone);
    const { data: newContact, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        tenant_id: input.tenantId,
        phone: phonePii.encrypted ?? input.senderPhone,
        phone_hash: phonePii.hash,
        name: encryptContactName(input.contactName) ?? input.contactName,
      })
      .select('id, name')
      .single();
    if (error) {
      return {
        contactId: '',
        contactName: null,
        conversationId: '',
        convStatus: null,
        isNewConversation: false,
        messageInserted: false,
        wasDuplicateWebhook: false,
        pathUsed: 'legacy',
        aborted: true,
        errorMessage: `contact insert failed: ${error.message}`,
      };
    }
    contact = newContact;
  }

  // 2. Conversation — lookup by blind index when available
  let convQuery = supabaseAdmin
    .from('conversations')
    .select('id, status, customer_name')
    .eq('tenant_id', input.tenantId)
    .eq('channel', 'whatsapp');
  if (lookupHash) {
    convQuery = convQuery.eq('customer_phone_hash', lookupHash);
  } else {
    convQuery = convQuery.eq('customer_phone', input.senderPhone);
  }
  let { data: conv } = await convQuery.single();

  const isNewConversation = !conv;

  if (!conv) {
    const phonePii = encryptContactPhone(input.senderPhone);
    const { data: newConv, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        tenant_id: input.tenantId,
        contact_id: contact?.id,
        customer_phone: phonePii.encrypted ?? input.senderPhone,
        customer_phone_hash: phonePii.hash,
        customer_name: encryptContactName(contact?.name as string) ?? (contact?.name || null),
        channel: 'whatsapp',
      })
      .select('id, status, customer_name')
      .single();
    if (error) {
      return {
        contactId: (contact?.id as string) ?? '',
        contactName: (contact?.name as string) ?? null,
        conversationId: '',
        convStatus: null,
        isNewConversation: false,
        messageInserted: false,
        wasDuplicateWebhook: false,
        pathUsed: 'legacy',
        aborted: true,
        errorMessage: `conversation insert failed: ${error.message}`,
      };
    }
    conv = newConv;
  }

  // 3. Message (unique constraint on wa_message_id ⇒ duplicate webhook safe)
  const mediaType = ['audio', 'image', 'document', 'video'].includes(input.messageType)
    ? input.messageType
    : null;

  const { error: msgErr } = await supabaseAdmin.from('messages').insert({
    conversation_id: conv!.id,
    tenant_id: input.tenantId,
    direction: 'inbound',
    sender_type: 'customer',
    content: encryptPII(input.content),
    message_type: input.messageType,
    wa_message_id: input.waMessageId,
    media_type: mediaType,
    media_transcription: encryptPII(input.mediaTranscription),
    media_description: encryptPII(input.mediaDescription),
  });

  let messageInserted = !msgErr;
  let wasDuplicate = false;
  let aborted = false;
  let errorMessage: string | undefined;

  if (msgErr) {
    if ((msgErr as { code?: string }).code === '23505') {
      wasDuplicate = true;
      messageInserted = false;
    } else {
      aborted = true;
      errorMessage = `message insert failed: ${msgErr.message}`;
    }
  }

  return {
    contactId: (contact?.id as string) ?? '',
    contactName: (contact?.name as string) ?? null,
    conversationId: (conv?.id as string) ?? '',
    convStatus: (conv?.status as string) ?? null,
    isNewConversation,
    messageInserted,
    wasDuplicateWebhook: wasDuplicate,
    pathUsed: 'legacy',
    aborted,
    errorMessage,
  };
}
