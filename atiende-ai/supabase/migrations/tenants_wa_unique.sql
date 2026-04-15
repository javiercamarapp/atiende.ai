-- ════════════════════════════════════════════════════════════════════════════
-- TENANTS WA PHONE UNIQUE — aislamiento multi-tenant blindado (AUDIT R12)
--
-- Problema:
--   El pipeline de webhooks usa supabaseAdmin (service_role, bypass RLS) y
--   resuelve tenant vía `.eq('wa_phone_number_id', id).single()`. Sin UNIQUE
--   constraint, si por bug de onboarding 2 tenants distintos quedan con el
--   mismo wa_phone_number_id, `.single()` falla (PostgREST error PGRST116)
--   o peor, `.maybeSingle()` devuelve aleatorio — mensajes de una clínica
--   van a BD de otro tenant.
--
-- Fix: UNIQUE constraint.
--   - En adelante, el INSERT/UPDATE que cree un duplicado falla con 23505
--   - El onboarding detecta el error y pide corregir el número antes de guardar
-- ════════════════════════════════════════════════════════════════════════════

-- Detectar duplicados ANTES de aplicar UNIQUE (rompería si existen)
-- Idempotente: chequea pg_constraint ANTES de intentar ADD.
DO $$
DECLARE
  dup_count INT;
  constraint_exists BOOLEAN;
BEGIN
  -- Si ya existe, salir (idempotencia real)
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_wa_phone_number_id_unique'
      AND conrelid = 'tenants'::regclass
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RAISE NOTICE 'Constraint tenants_wa_phone_number_id_unique ya existe — skip';
    RETURN;
  END IF;

  -- Detectar duplicados (bloquean creación)
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT wa_phone_number_id FROM tenants
    WHERE wa_phone_number_id IS NOT NULL
    GROUP BY wa_phone_number_id HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % duplicate wa_phone_number_id — manual cleanup required BEFORE UNIQUE constraint', dup_count;
    RETURN;
  END IF;

  ALTER TABLE tenants
    ADD CONSTRAINT tenants_wa_phone_number_id_unique UNIQUE (wa_phone_number_id);
  RAISE NOTICE 'Constraint creado OK';
END $$;
