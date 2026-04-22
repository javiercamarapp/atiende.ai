-- Atomic set/clear conversation state using jsonb_set.
-- Avoids read-modify-write race condition in application code.
CREATE OR REPLACE FUNCTION set_conversation_state(
  p_conversation_id UUID,
  p_state TEXT,          -- NULL to clear
  p_context JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID AS $$
BEGIN
  IF p_state IS NULL THEN
    UPDATE conversations
    SET metadata = COALESCE(metadata, '{}'::JSONB) - 'conversation_state'
    WHERE id = p_conversation_id;
  ELSE
    UPDATE conversations
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::JSONB),
      '{conversation_state}',
      jsonb_build_object('state', p_state, 'context', p_context)
    )
    WHERE id = p_conversation_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
