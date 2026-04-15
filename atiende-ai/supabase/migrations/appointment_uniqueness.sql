-- ════════════════════════════════════════════════════════════════════════════
-- APPOINTMENT UNIQUENESS — Phase 12
--
-- Constraint UNIQUE en (tenant_id, staff_id, datetime) para prevenir
-- double-booking por race condition en book_appointment.
--
-- hasConflict() es check + INSERT no-atómico. Dos pacientes simultáneos
-- pueden ambos pasar el check antes de que cualquiera inserte. Esta
-- constraint cierra el gap a nivel DB.
--
-- DEFERRABLE INITIALLY DEFERRED para no romper updates/migraciones que
-- temporalmente desordenan slots.
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_appointment_slot'
  ) THEN
    -- Limpiar duplicados existentes ANTES del ALTER (mantener el más antiguo)
    DELETE FROM appointments
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY tenant_id, staff_id, datetime
          ORDER BY created_at ASC
        ) AS rn
        FROM appointments
        WHERE status IN ('scheduled', 'confirmed')
          AND staff_id IS NOT NULL
      ) dups
      WHERE rn > 1
    );

    -- Solo aplica a citas activas con staff asignado.
    -- Una cita cancelada/no_show puede coexistir con una nueva en mismo slot.
    ALTER TABLE appointments
      ADD CONSTRAINT uniq_appointment_slot
      UNIQUE (tenant_id, staff_id, datetime)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
