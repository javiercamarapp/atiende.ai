-- Motivo de la cita (reason).
--
-- Hasta ahora el pipeline guardaba lo que el paciente dijese al agendar
-- dentro de `notes`, que era un campo libre usado también para "el doctor
-- tiene que saber X" y quedaba mezclado. Separamos a su propia columna
-- para poder:
--   a) mostrarlo en el historial del paciente (/contacts/[id]) como una
--      columna dedicada tipo "Motivo"
--   b) filtrar/agrupar por motivo en analytics (ej. "X% de citas son
--      limpiezas", "Y% emergencias")
--   c) el agente LLM lo incluye como argumento explícito de book_appointment
--      en vez de concatenarlo a notes (→ retrieval más robusto).
--
-- `notes` se preserva para las anotaciones internas del dueño / comentarios
-- adicionales. Nullable porque hay legacy rows sin reason.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Index solo si volumen lo justifica; por ahora no — tenants típicos
-- tienen <1000 citas/año y el índice compuesto existente (tenant_id +
-- datetime) sigue siendo el primario de acceso.
