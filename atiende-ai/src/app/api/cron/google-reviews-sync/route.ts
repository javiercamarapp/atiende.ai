// ═════════════════════════════════════════════════════════════════════════════
// CRON — Google Reviews Sync (Phase 3)
//
// Weekly. Para cada tenant con google_place_id configurado:
//   1. Llama la Places API (legacy details endpoint)
//   2. Upsert reseñas en google_reviews (dedupe por review_key)
//   3. Actualiza tenants.google_reviews_last_sync_at + _last_count
//
// Corre con API key del operador del SaaS (GOOGLE_PLACES_API_KEY).
// No bloqueamos si un tenant falla — log + sigue.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCronAuth,
  listEligibleTenants,
  logCronRun,
} from '@/lib/agents/internal/cron-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchGooglePlaceReviews } from '@/lib/integrations/google-places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY not configured' }, { status: 500 });
  }

  const start = new Date();
  const tenants = await listEligibleTenants({ requireToolCalling: false });

  let processed = 0;
  let failed = 0;
  let totalReviews = 0;
  const summaries: Array<Record<string, unknown>> = [];

  for (const t of tenants) {
    const tenantId = t.id as string;
    const placeId = (t.google_place_id as string | null) ?? null;
    if (!placeId) continue;

    try {
      const result = await fetchGooglePlaceReviews(placeId, apiKey);
      if (!result.ok) {
        summaries.push({ tenant_id: tenantId, error: result.error });
        failed++;
        continue;
      }

      if (result.reviews.length > 0) {
        const rows = result.reviews.map((r) => ({
          tenant_id: tenantId,
          review_key: r.review_key,
          reviewer_name: r.reviewer_name,
          rating: r.rating,
          comment: r.comment,
          comment_lang: r.comment_lang,
          posted_at: r.posted_at,
        }));
        // Upsert con onConflict sobre (tenant_id, review_key) — si ya existe
        // la reseña, no creamos duplicado. Si el texto cambió (el usuario
        // editó), actualizamos.
        const { error: upErr } = await supabaseAdmin
          .from('google_reviews')
          .upsert(rows, { onConflict: 'tenant_id,review_key' });
        if (upErr) throw upErr;
      }

      await supabaseAdmin
        .from('tenants')
        .update({
          google_reviews_last_sync_at: new Date().toISOString(),
          google_reviews_last_count: result.reviews.length,
        })
        .eq('id', tenantId);

      totalReviews += result.reviews.length;
      summaries.push({
        tenant_id: tenantId,
        reviews_synced: result.reviews.length,
        rating_avg: result.rating_avg,
        rating_count: result.rating_count,
      });
      processed++;
    } catch (err) {
      console.error('[cron/google-reviews-sync] tenant failed:', tenantId, err);
      summaries.push({
        tenant_id: tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  await logCronRun({
    jobName: 'google-reviews-sync',
    startedAt: start,
    tenantsProcessed: processed + failed,
    tenantsSucceeded: processed,
    tenantsFailed: failed,
    details: { total_reviews_synced: totalReviews, summaries: summaries.slice(0, 20) },
  });

  return NextResponse.json({
    ok: true,
    tenants_processed: processed,
    tenants_failed: failed,
    total_reviews_synced: totalReviews,
  });
}
