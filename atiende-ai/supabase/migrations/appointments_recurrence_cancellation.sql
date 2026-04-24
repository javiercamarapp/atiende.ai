-- Optional columns for richer appointment metadata:
--   recurrence_group_id — links occurrences created together via the
--     weekly-repeat option so they can be fetched/managed as a series.
--   cancellation_reason — stored when a staff-initiated cancel supplies one.
--
-- Both are nullable and the app code gracefully degrades if they're missing,
-- so running this migration is optional but recommended.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS recurrence_group_id UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_group
  ON appointments (recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;
