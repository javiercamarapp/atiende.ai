-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — 4 critical fixes
--
--
-- P0.1 — Revocar GRANT EXECUTE TO authenticated en upsert_inbound_message.
--        La función es SECURITY DEFINER; un user autenticado podía invocarla
--        con CUALQUIER p_tenant_id y escribir a tenant ajeno bypassing RLS.
--        En producción el webhook usa service_role, así que no hay daño
--        observado — pero la superficie de ataque existía.
--
-- P0.2 — EXCLUSION CONSTRAINT para appointments.
--        El UNIQUE actual (tenant_id, staff_id, datetime) solo cubre match
--        EXACTO. No previene solape parcial: 10:00-10:30 + 10:15-10:45 con
--        mismo staff pasan el UNIQUE pero son double-booking. Además el
--        UNIQUE no filtra por status — un appointment cancelado al mismo
--        slot bloquea uno nuevo. Se reemplaza por EXCLUDE USING gist con
--        tsrange (rango semi-abierto [start, end)) filtrado por status activo.
--
-- P0.4 — Default `llm_classifier` apuntaba a `openai/gpt-5-nano`, modelo
--        que NO existe (confirmado por comentario en openrouter.ts). Tenants
--        creados antes del fix de código nacían con config rota.
--
-- P0.5 — WITH CHECK faltante en 5 tablas: webhook_logs, agent_versions,
--        classification_feedback, agent_executions, metrics_snapshots.
--        La migración previa rls_with_check.sql no las incluía. Sin
--        WITH CHECK explícito un UPDATE podría mover filas entre tenant_id.
--
-- Migración idempotente. Si algún constraint ya existe, se omite.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- P0.1 — Restringir upsert_inbound_message a service_role solamente
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'upsert_inbound_message'
  ) THEN
    REVOKE EXECUTE ON FUNCTION upsert_inbound_message(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
    ) FROM authenticated;
    -- service_role mantiene EXECUTE (lo necesita el webhook processor).
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P0.2 — EXCLUSION CONSTRAINT contra solape parcial de appointments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  -- Drop el UNIQUE antiguo (solo cubre match exacto) si existe.
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_appointment_slot'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT uniq_appointment_slot;
  END IF;

  -- Crear EXCLUSION con GiST + tsrange. Solo activos ('scheduled','confirmed').
  -- end_datetime puede ser NULL en data vieja — usamos datetime + 30min como
  -- default defensivo (pero la app debe enviar end_datetime explícito).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_appointment_overlap'
  ) THEN
    -- Limpiar solapes existentes antes de aplicar (mantener el más antiguo).
    DELETE FROM appointments a
    USING appointments b
    WHERE a.id <> b.id
      AND a.tenant_id = b.tenant_id
      AND a.staff_id = b.staff_id
      AND a.staff_id IS NOT NULL
      AND a.status IN ('scheduled', 'confirmed')
      AND b.status IN ('scheduled', 'confirmed')
      AND tsrange(
            a.datetime,
            COALESCE(a.end_datetime, a.datetime + interval '30 minutes'),
            '[)'
          ) && tsrange(
            b.datetime,
            COALESCE(b.end_datetime, b.datetime + interval '30 minutes'),
            '[)'
          )
      AND a.created_at > b.created_at;

    ALTER TABLE appointments ADD CONSTRAINT no_appointment_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        staff_id WITH =,
        tsrange(
          datetime,
          COALESCE(end_datetime, datetime + interval '30 minutes'),
          '[)'
        ) WITH &&
      )
      WHERE (status IN ('scheduled', 'confirmed') AND staff_id IS NOT NULL);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P0.4 — Corregir default `llm_classifier` (modelo inexistente gpt-5-nano)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ALTER COLUMN llm_classifier SET DEFAULT 'openai/gpt-4o-mini';

-- Actualizar tenants existentes que quedaron con el default roto.
UPDATE tenants
SET llm_classifier = 'openai/gpt-4o-mini'
WHERE llm_classifier = 'openai/gpt-5-nano';

-- ─────────────────────────────────────────────────────────────────────────────
-- P0.5 — WITH CHECK explícito en las 5 tablas que rls_with_check.sql omitió
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  policy_name TEXT;
  missing_tables TEXT[] := ARRAY[
    'webhook_logs',
    'agent_versions',
    'classification_feedback',
    'agent_executions',
    'metrics_snapshots'
  ];
  policy_names TEXT[] := ARRAY[
    'tenant_data',
    'tenant_agent_versions',
    'tenant_classification_feedback',
    'tenant_agent_executions',
    'tenant_metrics_snapshots'
  ];
BEGIN
  FOR i IN 1..array_length(missing_tables, 1) LOOP
    t := missing_tables[i];
    policy_name := policy_names[i];
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, t);
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL ' ||
        'USING (tenant_id = get_user_tenant_id()) ' ||
        'WITH CHECK (tenant_id = get_user_tenant_id())',
        policy_name, t
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON CONSTRAINT no_appointment_overlap ON appointments IS
  'Previene double-booking parcial. Reemplaza uniq_appointment_slot.';
