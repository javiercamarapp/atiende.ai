-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: conversation_summary
-- Agrega columnas para summary persistente en conversations. Permite que el
-- LLM mantenga contexto entre 50+ mensajes sin que el historial truncado
-- (últimos 12) le haga "olvidar" lo que el paciente dijo turnos atrás.
--
-- Se actualiza con LLM cheap (Gemini Flash-Lite) cada 5 turnos. El prompt
-- del orquestador inyecta el summary en system message para que sobreviva
-- la truncación.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS summary_message_count INT DEFAULT 0;

-- Index para encontrar conversations que necesitan re-summary (cron opcional)
CREATE INDEX IF NOT EXISTS idx_conv_summary_stale
  ON conversations (summary_updated_at)
  WHERE summary IS NOT NULL;

COMMENT ON COLUMN conversations.summary IS
  'Resumen narrativo persistente de la conversación, actualizado cada N turnos por el orquestador. Inyectado en el system prompt para sobrevivir history truncation.';
