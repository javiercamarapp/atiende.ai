-- Phase 2.C.1 — Telemedicine (videollamada integrada)
--
-- Post-COVID el 30% de consultas son remotas. Sin telemed no retenemos ese
-- subset de pacientes. Integramos Jitsi Meet por simplicidad (sin API key
-- ni costo per-room) — room names únicos por cita, hosted en meet.jit.si.
-- Upgrade path: swap provider a Daily.co / Jitsi-JaaS sin tocar schema.
--
-- Lo que agrega:
--   - tenants.telemedicine_enabled: flag global del tenant. El dueño la
--     activa desde /settings/agent si quiere ofrecer telemed.
--   - tenants.telemedicine_provider: 'jitsi' (default) | 'daily' |
--     'custom_url'. Facilita swap sin migration nueva.
--   - appointments.is_telemedicine: marca que la cita es remota.
--   - appointments.telemed_room: identifier generado al book_appointment
--     (ej. 'atiende-<tenant-slug>-<apt-short-id>'); se usa para construir
--     la URL final.
--   - appointments.telemed_link_sent_at: para auditar que efectivamente
--     se envió el link al paciente (útil para debugging "no recibí link").
--
-- IDEMPOTENTE.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS telemedicine_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telemedicine_provider TEXT             DEFAULT 'jitsi'
    CHECK (telemedicine_provider IN ('jitsi', 'daily', 'custom_url'));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_telemedicine      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telemed_room         TEXT,
  ADD COLUMN IF NOT EXISTS telemed_link_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_apt_telemedicine
  ON appointments (tenant_id, datetime)
  WHERE is_telemedicine = TRUE;
