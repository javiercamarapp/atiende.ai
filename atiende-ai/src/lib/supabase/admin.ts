import { createClient } from '@supabase/supabase-js';

// SOLO usar en server-side (webhooks, crons, API routes)
// Bypasses RLS — tiene acceso total
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
