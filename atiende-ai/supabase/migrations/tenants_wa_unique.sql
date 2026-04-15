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
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT wa_phone_number_id FROM tenants
    WHERE wa_phone_number_id IS NOT NULL
    GROUP BY wa_phone_number_id HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % duplicate wa_phone_number_id — manual cleanup required BEFORE UNIQUE constraint', dup_count;
  ELSE
    BEGIN
      ALTER TABLE tenants
        ADD CONSTRAINT tenants_wa_phone_number_id_unique UNIQUE (wa_phone_number_id);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- ya existe
    END;
  END IF;
END $$;
