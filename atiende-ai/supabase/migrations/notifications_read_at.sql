ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS notifications_read_at TIMESTAMPTZ DEFAULT now();
