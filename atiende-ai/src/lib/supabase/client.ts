import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Singleton del browser client. Antes, cada `createClient()` construía una
// nueva instancia: cada componente que la llamaba dentro de un useEffect
// disparaba listeners adicionales sobre los eventos de auth, y agregaba
// suscripciones a Realtime que nunca se limpiaban. Resultado: leaks de
// memoria y pings de Supabase Auth multiplicados.
//
// Ahora hay UNA instancia compartida para toda la app del browser. Server
// Components siguen usando `createServerSupabase()` (que es per-request por
// las cookies) — esa rama no se ve afectada.
let _client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _client;
}
