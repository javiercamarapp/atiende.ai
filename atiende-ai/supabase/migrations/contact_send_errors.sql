-- ════════════════════════════════════════════════════════════════════════════
-- CONTACT SEND ERRORS — visibilidad de bloqueos / fallas de Meta (WA-1)
--
-- Cuando intentamos enviar un mensaje a un paciente y Meta retorna un error
-- (número inválido 131030, fuera de ventana 24h 131047, paciente bloqueó al
-- negocio, etc.), persistimos el código en `contacts` para que el dueño del
-- consultorio pueda ver desde el dashboard qué pacientes ya no son
-- contactables y por qué.
--
-- Sin estas columnas, los errores se perdían en `console.warn` y el negocio
-- creía que el paciente estaba siendo notificado.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_send_error_code INT,
  ADD COLUMN IF NOT EXISTS last_send_error_label TEXT,
  ADD COLUMN IF NOT EXISTS last_send_error_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_send_error
  ON contacts(tenant_id, last_send_error_code)
  WHERE last_send_error_code IS NOT NULL;

COMMENT ON COLUMN contacts.last_send_error_code IS
  'Código numérico Meta del último error de envío (131030, 131047, etc.). NULL = ningún error.';
COMMENT ON COLUMN contacts.last_send_error_label IS
  'Etiqueta legible: recipient_not_in_allowed_list, reengagement_required, etc.';
COMMENT ON COLUMN contacts.last_send_error_at IS
  'Timestamp del último error — útil para purgar si el paciente vuelve a respondernos.';
