-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: production_readiness_fixes
-- Aplica los fixes del commit 6f77197 (production-readiness para WhatsApp).
-- Idempotente: seguro de correr múltiples veces.
--
-- Cambios incluidos:
--   1. Función plural `get_user_tenant_ids()` que las RLS policies usan
--   2. Extensión `btree_gist` + EXCLUDE constraint anti-doble-booking
--   3. Columnas `calendar_sync_*` en appointments + índice parcial
--
-- Cómo aplicar en prod (Supabase Dashboard):
--   1. Ir a SQL Editor → New Query
--   2. Pegar este archivo completo
--   3. Run
--   4. Verificar con los SELECTs al final
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. FUNCIÓN RLS PLURAL ─────────────────────────────────────────────────
-- Las policies en schema.sql usan `tenant_id = ANY(get_user_tenant_ids())`
-- pero la función original era singular. Antes de este fix, las policies
-- referenciaban una función inexistente y fallaban silenciosamente.
--
-- COALESCE a array vacío garantiza que `= ANY(...)` se evalúe determinístico
-- (FALSE) cuando el usuario no es dueño de ningún tenant — NULL en RLS
-- rompe el aislamiento.

CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT COALESCE(
  (SELECT ARRAY_AGG(id) FROM public.tenants WHERE user_id = auth.uid()),
  ARRAY[]::UUID[]
);
$$;

-- ─── 2. ANTI-DOBLE-BOOKING ATÓMICO ─────────────────────────────────────────
-- `hasConflict()` + `INSERT` en application code NO es atómico. Dos
-- webhooks paralelos pueden pasar el check al mismo tiempo y luego ambos
-- insertar. El EXCLUDE constraint hace la verificación a nivel DB:
-- Postgres falla el segundo INSERT con SQLSTATE 23P01.
--
-- Citas canceladas/no-show NO bloquean el slot (WHERE filtra por status).
-- Reservaciones de restaurante (sin staff_id) NO entran al constraint —
-- requieren capacity-based logic separada (table count / room inventory).

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_no_overlap'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_no_overlap
      EXCLUDE USING gist (
        staff_id WITH =,
        tstzrange(datetime, end_datetime, '[)') WITH &&
      )
      WHERE (
        staff_id IS NOT NULL
        AND end_datetime IS NOT NULL
        AND status IN ('scheduled', 'confirmed')
      );
  END IF;
END $$;

-- ─── 3. RECONCILIACIÓN GOOGLE CALENDAR ─────────────────────────────────────
-- Sin estas columnas, una caída de la API de Google Calendar deja citas
-- agendadas en Postgres pero no en el calendario del staff. El cron
-- `/api/cron/calendar-reconcile` (cada 5min) reintenta sync.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT DEFAULT 'pending';
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_attempts INT DEFAULT 0;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_last_error TEXT;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_apt_sync_pending
  ON appointments(calendar_sync_next_retry_at)
  WHERE calendar_sync_status IN ('pending', 'cancel');

-- Backfill: citas existentes con google_event_id ya estaban sincronizadas
-- antes de este patch. Marcarlas 'synced' para que no entren al cron.
UPDATE appointments
SET calendar_sync_status = 'synced'
WHERE google_event_id IS NOT NULL
  AND calendar_sync_status = 'pending';

-- Citas existentes sin google_event_id pero que ya pasaron (status
-- completed/cancelled/no_show): marcar 'skip' — no hay nada que sync.
UPDATE appointments
SET calendar_sync_status = 'skip'
WHERE google_event_id IS NULL
  AND status NOT IN ('scheduled', 'confirmed')
  AND calendar_sync_status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr después del apply para confirmar)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Función plural existe:
--      SELECT get_user_tenant_ids();   -- debe devolver {} si no auth
-- 2. EXCLUDE constraint existe:
--      SELECT conname FROM pg_constraint
--      WHERE conname = 'appointments_no_overlap';
-- 3. Columnas de sync existen:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'appointments'
--        AND column_name LIKE 'calendar_sync_%';
-- 4. Probar el constraint:
--      INSERT INTO appointments (..., staff_id='X', datetime='2030-01-01 10:00',
--        end_datetime='2030-01-01 11:00', status='scheduled');
--      INSERT INTO appointments (..., staff_id='X', datetime='2030-01-01 10:30',
--        end_datetime='2030-01-01 11:30', status='scheduled');
--      -- Segundo INSERT debe fallar con: ERROR: 23P01 conflicting key
