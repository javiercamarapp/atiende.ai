import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// SOLO usar en server-side (webhooks, crons, API routes)
// Bypasses RLS — tiene acceso total
//
// Lazy-initialized to avoid crashing during Next.js client-side module
// evaluation where SUPABASE_SERVICE_ROLE_KEY is not available.
let _admin: SupabaseClient | null = null;

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_admin) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          'supabaseAdmin requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
        );
      }
      _admin = createClient(url, key);
    }
    const value = (_admin as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(_admin) : value;
  },
});
