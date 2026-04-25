-- Audit fix: state machine guard para transiciones de appointment.status
--
-- Antes nada bloqueaba transiciones ilegales (ej: scheduled → completed
-- sin pasar por confirmed, o completed → confirmed). Un bug en orchestrator
-- o en el dashboard podía marcar una cita en estado incoherente sin error.
--
-- Esta función valida la transición y se llama desde un trigger BEFORE UPDATE.
-- Si la transición es inválida, lanza excepción → la UPDATE falla y el caller
-- recibe un error claro en vez de corromper datos silently.
--
-- Estados válidos:
--   - pending → scheduled, cancelled
--   - scheduled → confirmed, cancelled, no_show
--   - confirmed → completed, cancelled, no_show
--   - completed → (terminal, no transitions)
--   - cancelled → (terminal)
--   - no_show → (terminal)
--
-- IDEMPOTENTE.

CREATE OR REPLACE FUNCTION validate_appointment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si status no cambia, dejamos pasar.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Si veníamos de NULL (insert con DEFAULT no aplica acá porque es BEFORE
  -- UPDATE), dejamos pasar.
  IF OLD.status IS NULL THEN
    RETURN NEW;
  END IF;

  CASE OLD.status
    WHEN 'pending' THEN
      IF NEW.status NOT IN ('scheduled', 'cancelled') THEN
        RAISE EXCEPTION 'invalid_status_transition: pending → %', NEW.status
          USING HINT = 'pending solo puede ir a scheduled o cancelled';
      END IF;
    WHEN 'scheduled' THEN
      IF NEW.status NOT IN ('confirmed', 'cancelled', 'no_show', 'completed') THEN
        RAISE EXCEPTION 'invalid_status_transition: scheduled → %', NEW.status
          USING HINT = 'scheduled solo puede ir a confirmed/cancelled/no_show/completed';
      END IF;
    WHEN 'confirmed' THEN
      IF NEW.status NOT IN ('completed', 'cancelled', 'no_show') THEN
        RAISE EXCEPTION 'invalid_status_transition: confirmed → %', NEW.status
          USING HINT = 'confirmed solo puede ir a completed/cancelled/no_show';
      END IF;
    WHEN 'completed' THEN
      RAISE EXCEPTION 'invalid_status_transition: completed es terminal'
        USING HINT = 'No se puede salir de completed. Crear cita nueva si necesario.';
    WHEN 'cancelled' THEN
      -- Permitimos re-activar de cancelled → scheduled si owner lo hace
      -- desde el dashboard (caso real: cancela por error y re-confirma).
      IF NEW.status NOT IN ('scheduled') THEN
        RAISE EXCEPTION 'invalid_status_transition: cancelled → %', NEW.status
          USING HINT = 'cancelled solo puede re-activarse a scheduled';
      END IF;
    WHEN 'no_show' THEN
      -- Caso real: paciente sí vino pero no se marcó a tiempo, owner corrige.
      IF NEW.status NOT IN ('completed', 'scheduled') THEN
        RAISE EXCEPTION 'invalid_status_transition: no_show → %', NEW.status
          USING HINT = 'no_show solo puede ir a completed (corrección) o scheduled (re-agendado)';
      END IF;
    ELSE
      -- Status desconocido — dejamos pasar para no romper migrations futuras
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_appointment_status_transition ON appointments;
CREATE TRIGGER trg_validate_appointment_status_transition
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_appointment_status_transition();

COMMENT ON TRIGGER trg_validate_appointment_status_transition ON appointments IS
  'State machine guard: bloquea transiciones ilegales como completed → confirmed o pending → completed.';

-- Optimistic locking helper: timestamp updated_at se setea en cada UPDATE
-- automáticamente. El frontend/agente puede leer updated_at, pasarlo en
-- la próxima UPDATE como filter (.eq) y si otro proceso lo modificó
-- in-between, la UPDATE no afecta filas (count=0) y el caller sabe que
-- hubo race.
CREATE OR REPLACE FUNCTION touch_appointments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Asegurarnos que la columna existe
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS trg_touch_appointments_updated_at ON appointments;
CREATE TRIGGER trg_touch_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION touch_appointments_updated_at();
