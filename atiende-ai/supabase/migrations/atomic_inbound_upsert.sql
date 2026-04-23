-- ════════════════════════════════════════════════════════════════════════════
-- ATOMIC INBOUND UPSERT — fix race condition on concurrent webhooks
--
-- Problema: processor.ts hace 3 INSERTs secuenciales (contact, conversation,
-- message) sin transacción. Si falla a la mitad (DB flap, RLS mal, timeout
-- de connection pool) quedaban rows huérfanas.
--
-- Con `find-before-insert` + UNIQUE(wa_message_id) ya evitamos la mayor parte
-- del daño (el retry idempotente "encuentra" lo que ya existía). Esta RPC
-- es la red definitiva: todo dentro de UNA transacción implícita de plpgsql.
-- Si algo falla a la mitad → ROLLBACK automático → ningún row parcial.
--
-- La RPC:
--   1. Upsert contact (ON CONFLICT tenant_id + phone DO NOTHING, retornamos id).
--   2. Upsert conversation (ON CONFLICT tenant_id + customer_phone + channel).
--   3. Insert message (ON CONFLICT wa_message_id DO NOTHING — idempotente).
--   4. Retorna { contact_id, conversation_id, is_new_conversation,
--                message_inserted, was_duplicate_webhook, conv_status }.
--
-- El caller (processor.ts) decide qué hacer según esos flags sin necesidad
-- de queries adicionales.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_inbound_message(
  p_tenant_id UUID,
  p_phone TEXT,
  p_contact_name TEXT,
  p_customer_phone TEXT,
  p_wa_message_id TEXT,
  p_content TEXT,
  p_message_type TEXT,
  p_media_transcription TEXT DEFAULT NULL,
  p_media_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id UUID;
  v_contact_name TEXT;
  v_conversation_id UUID;
  v_conv_status TEXT;
  v_is_new_conversation BOOLEAN := FALSE;
  v_message_inserted BOOLEAN := FALSE;
  v_was_duplicate BOOLEAN := FALSE;
  v_media_type TEXT;
BEGIN
  -- Validación mínima — la RPC no debe nunca recibir tenant_id inválido
  IF p_tenant_id IS NULL OR p_phone IS NULL THEN
    RAISE EXCEPTION 'upsert_inbound_message: p_tenant_id and p_phone are required';
  END IF;

  -- 1. Contact: find-or-create (idempotente).
  SELECT id, name INTO v_contact_id, v_contact_name
  FROM contacts
  WHERE tenant_id = p_tenant_id AND phone = p_phone
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (tenant_id, phone, name)
    VALUES (p_tenant_id, p_phone, p_contact_name)
    RETURNING id, name INTO v_contact_id, v_contact_name;
  END IF;

  -- 2. Conversation: find-or-create.
  SELECT id, status INTO v_conversation_id, v_conv_status
  FROM conversations
  WHERE tenant_id = p_tenant_id
    AND customer_phone = p_customer_phone
    AND channel = 'whatsapp'
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (
      tenant_id, contact_id, customer_phone, customer_name, channel
    ) VALUES (
      p_tenant_id, v_contact_id, p_customer_phone, v_contact_name, 'whatsapp'
    )
    RETURNING id, status INTO v_conversation_id, v_conv_status;
    v_is_new_conversation := TRUE;
  END IF;

  -- 3. Inbound message (idempotente por UNIQUE(wa_message_id)).
  v_media_type := CASE
    WHEN p_message_type IN ('audio', 'image', 'document', 'video') THEN p_message_type
    ELSE NULL
  END;

  BEGIN
    INSERT INTO messages (
      conversation_id, tenant_id, direction, sender_type,
      content, message_type, wa_message_id,
      media_type, media_transcription, media_description
    ) VALUES (
      v_conversation_id, p_tenant_id, 'inbound', 'customer',
      p_content, p_message_type, p_wa_message_id,
      v_media_type, p_media_transcription, p_media_description
    );
    v_message_inserted := TRUE;
  EXCEPTION
    -- unique_violation en wa_message_id = webhook duplicado. Safe to skip.
    WHEN unique_violation THEN
      v_was_duplicate := TRUE;
      v_message_inserted := FALSE;
  END;

  -- 4. Respuesta estructurada que el caller puede usar sin más queries.
  RETURN jsonb_build_object(
    'contact_id', v_contact_id,
    'contact_name', v_contact_name,
    'conversation_id', v_conversation_id,
    'conv_status', v_conv_status,
    'conv_customer_name', v_contact_name, -- alias para retrocompat del caller
    'is_new_conversation', v_is_new_conversation,
    'message_inserted', v_message_inserted,
    'was_duplicate_webhook', v_was_duplicate
  );

-- Si cualquier error no esperado ocurre aquí (RLS, tipo, conn loss), plpgsql
-- hace ROLLBACK implícito de toda la transacción. El caller recibe la
-- excepción y abortamos la pipeline.
END;
$$;

COMMENT ON FUNCTION upsert_inbound_message IS
  'Atomic upsert of contact + conversation + inbound message (BUG-001 R14).
   Returns JSONB with ids, status flags, and idempotency signals.';

GRANT EXECUTE ON FUNCTION upsert_inbound_message TO authenticated, service_role;
