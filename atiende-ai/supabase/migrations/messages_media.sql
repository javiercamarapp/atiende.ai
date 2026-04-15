-- ════════════════════════════════════════════════════════════════════════════
-- MESSAGES MEDIA — multimedia inbound (MISIÓN 2)
--
-- Agrega columnas para persistir transcripciones (audio→Whisper) y
-- descripciones (imagen→Gemini, PDF→pdf-parse o Gemini fallback).
--
-- - media_type: tipo procesado (audio | image | document | video)
-- - media_transcription: texto literal del audio (Whisper)
-- - media_description: descripción visual o texto extraído del PDF
--
-- El campo `content` ya existente conserva la representación final pasada
-- al LLM (idéntica o derivada de transcription/description). Estos campos
-- nuevos son para auditoría, fine-tuning y dashboards de calidad.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_type TEXT
    CHECK (media_type IS NULL OR media_type IN ('audio', 'image', 'document', 'video')),
  ADD COLUMN IF NOT EXISTS media_transcription TEXT,
  ADD COLUMN IF NOT EXISTS media_description TEXT;

-- Índice parcial — solo indexa filas con multimedia (la mayoría son texto).
CREATE INDEX IF NOT EXISTS idx_messages_media_type
  ON messages(tenant_id, media_type, created_at DESC)
  WHERE media_type IS NOT NULL;

COMMENT ON COLUMN messages.media_type IS
  'audio|image|document|video — null si message_type es text/interactive';
COMMENT ON COLUMN messages.media_transcription IS
  'Transcripción literal de audio (Whisper large-v3-turbo).';
COMMENT ON COLUMN messages.media_description IS
  'Descripción de imagen (Gemini Vision) o texto extraído de PDF (pdf-parse o Gemini).';
