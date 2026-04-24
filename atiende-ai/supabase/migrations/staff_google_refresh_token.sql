-- Migration: add google_refresh_token column to staff table.
-- Required for persistent Google Calendar OAuth: the encrypted refresh token
-- is stored per-staff so the agent can auto-refresh access tokens and keep
-- the connection alive indefinitely (or until the user revokes access).
--
-- Idempotent: safe to run multiple times.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;

COMMENT ON COLUMN staff.google_refresh_token IS
  'Encrypted (AES-GCM v1) Google OAuth refresh token. Obtained via /api/calendar/connect. Used by lib/calendar/google.ts to auto-refresh access tokens.';
