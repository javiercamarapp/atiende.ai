// ═════════════════════════════════════════════════════════════════════════════
// POST /api/tenants/google-reviews/sync
//
// Sync on-demand de las reseñas Google del tenant actual. Mismo código que el
// cron weekly pero scoped al tenant del user logueado y rate-limited a 1/min
// para no quemar la quota de Google Places ($17/1000 requests).
// ═════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchGooglePlaceReviews } from '@/lib/integrations/google-places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, google_place_id, google_reviews_last_sync_at')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });

  const placeId = tenant.google_place_id as string | null;
  if (!placeId) {
    return NextResponse.json({
      error: 'no_place_id',
      message: 'Configurá el Place ID de Google en /settings/locations primero.',
    }, { status: 400 });
  }

  // Rate limit: máximo 1 sync por minuto por tenant.
  const lastSync = tenant.google_reviews_last_sync_at as string | null;
  if (lastSync) {
    const elapsedMs = Date.now() - new Date(lastSync).getTime();
    if (elapsedMs < 60_000) {
      return NextResponse.json({
        error: 'rate_limited',
        message: 'Esperá 1 minuto entre sincronizaciones.',
        retry_after_seconds: Math.ceil((60_000 - elapsedMs) / 1000),
      }, { status: 429 });
    }
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'api_key_missing',
      message: 'GOOGLE_PLACES_API_KEY no configurada en el servidor. Contactá a soporte.',
    }, { status: 500 });
  }

  const result = await fetchGooglePlaceReviews(placeId, apiKey);
  if (!result.ok) {
    return NextResponse.json({
      error: 'google_failed',
      detail: result.error,
      retriable: result.retriable,
    }, { status: 502 });
  }

  if (result.reviews.length > 0) {
    const rows = result.reviews.map((r) => ({
      tenant_id: tenant.id as string,
      review_key: r.review_key,
      reviewer_name: r.reviewer_name,
      rating: r.rating,
      comment: r.comment,
      comment_lang: r.comment_lang,
      posted_at: r.posted_at,
    }));
    const { error: upErr } = await supabaseAdmin
      .from('google_reviews')
      .upsert(rows, { onConflict: 'tenant_id,review_key' });
    if (upErr) {
      return NextResponse.json({ error: 'db_failed', detail: upErr.message }, { status: 500 });
    }
  }

  await supabaseAdmin
    .from('tenants')
    .update({
      google_reviews_last_sync_at: new Date().toISOString(),
      google_reviews_last_count: result.reviews.length,
    })
    .eq('id', tenant.id as string);

  return NextResponse.json({
    ok: true,
    reviews_synced: result.reviews.length,
    rating_avg: result.rating_avg,
    rating_count: result.rating_count,
    place_name: result.place_name,
  });
}
