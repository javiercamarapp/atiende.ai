-- Phase 2.A — Public booking page (SEO + widget)
--
-- Tenants pueden exponer una URL pública `/book/<slug>` donde un paciente
-- SIN conversación previa de WhatsApp puede:
--   1. Ver disponibilidad del doctor
--   2. Agendar una cita rellenando nombre + teléfono + servicio + fecha/hora
--
-- Modelo:
--   - public_booking_links: el slug + enabled flag + límites per-tenant
--   - NO exponemos `tenants.id` en la URL (sería un UUID random feo);
--     un slug legible ("consultorio-dental-mayab") es mejor para SEO.
--
-- Abuse controls:
--   - rate limit por IP (Redis, ya existe infra)
--   - reCAPTCHA en el POST de booking (Phase 2.A.2)
--   - monthly_bookings_cap: si un tenant supera X bookings/mes vía public,
--     auto-desactiva el link hasta que renueve (anti-abuse si el link leak).
--   - link_expires_at: opcional, por si el tenant quiere temporary links
--     (campañas, etc.)
--
-- IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS public_booking_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Slug único a nivel global — parte de la URL pública `/book/<slug>`.
  -- Lowercase, alfanumérico + guiones. Validación a nivel aplicación
  -- (regex) y unicidad en DB.
  slug                  TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),

  -- Qué staff se expone públicamente. NULL = todos los staff activos del
  -- tenant. En Phase 2.B agregamos granularidad por practitioner; por
  -- ahora NULL o un UUID específico es suficiente.
  staff_id              UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Switch on/off sin borrar el row. El link responde 404/inactive si false.
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,

  -- Hard cap de bookings públicos al mes. Si se alcanza, el link devuelve
  -- "fully booked" hasta que el mes cambie o el dueño lo suba. Evita que
  -- un link leaked spamee la agenda.
  monthly_bookings_cap  INT DEFAULT 100,

  -- Contador mensual (resetea al 1 de cada mes vía cron o a demanda al
  -- leer). Para MVP lo calculamos on-read con COUNT sobre appointments.

  -- Opcional: link temporal (eventos, promos). Si NULL, permanente.
  link_expires_at       TIMESTAMPTZ,

  -- Texto custom que se muestra en la página pública (opcional).
  heading               TEXT,
  subheading            TEXT,

  -- Branding (colores hex). Si NULL, uso los defaults del tema.
  brand_color_hex       TEXT CHECK (brand_color_hex IS NULL OR brand_color_hex ~ '^#[0-9a-fA-F]{6}$'),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_booking_at       TIMESTAMPTZ
);

-- Lookups frecuentes: por tenant (dashboard) y por slug (cada request público)
CREATE INDEX IF NOT EXISTS idx_public_booking_tenant
  ON public_booking_links (tenant_id)
  WHERE enabled = TRUE;

-- El UNIQUE(slug) ya genera un índice; nada más que hacer.

-- RLS: el dueño puede ver/editar los suyos; el API público NO pasa por
-- RLS (usa supabaseAdmin) pero valida slug+enabled a mano.
ALTER TABLE public_booking_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'public_booking_links'
      AND policyname = 'tenant_data'
  ) THEN
    CREATE POLICY "tenant_data" ON public_booking_links FOR ALL
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- Tracking: en `appointments`, marcar las que vinieron vía public booking
-- para poder analizar conversión por source (compara contra WhatsApp).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS public_booking_link_id UUID REFERENCES public_booking_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apt_public_booking
  ON appointments (public_booking_link_id)
  WHERE public_booking_link_id IS NOT NULL;
