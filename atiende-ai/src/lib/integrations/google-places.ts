// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE PLACES — review fetching (Phase 3)
//
// Usamos el endpoint legacy `place/details` porque:
//   - No requiere OAuth (solo API key server-side)
//   - Devuelve hasta 5 reseñas "más relevantes" (mejor que el New API para
//     MVP — el new expone las mismas 5)
//   - Campo `reviews` es estable
//
// El tenant configura su Place ID; la API key la pone el operador del SaaS
// (GOOGLE_PLACES_API_KEY en el env). Esto simplifica onboarding — el cliente
// no necesita tener su propia key de Google Cloud.
//
// Quota: Places details = $17/1000 requests. Un sync semanal por tenant con
// 1000 tenants = 52 × 1000 = 52k requests/año = $884. Sync mensual = $204.
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const BASE = 'https://maps.googleapis.com/maps/api/place/details/json';

export interface GoogleReview {
  review_key: string;
  reviewer_name: string | null;
  rating: number;
  comment: string | null;
  comment_lang: string | null;
  posted_at: string;   // ISO
}

export interface FetchReviewsResult {
  ok: true;
  place_name: string | null;
  rating_avg: number | null;
  rating_count: number | null;
  reviews: GoogleReview[];
}
export interface FetchReviewsError {
  ok: false;
  error: string;
  retriable: boolean;
}

/**
 * Deriva un review_key estable a partir de los campos disponibles. Google no
 * expone un ID público así que combinamos (place_id + reviewer_name +
 * time_epoch). Si el usuario edita su review, el timestamp cambia — se
 * detecta como review nueva y el anterior queda como record histórico.
 */
function buildReviewKey(placeId: string, reviewerName: string, timeEpoch: number): string {
  return crypto
    .createHash('sha256')
    .update(`${placeId}|${reviewerName}|${timeEpoch}`)
    .digest('hex')
    .slice(0, 32);
}

export async function fetchGooglePlaceReviews(
  placeId: string,
  apiKey: string,
): Promise<FetchReviewsResult | FetchReviewsError> {
  if (!placeId || !apiKey) {
    return { ok: false, error: 'missing_place_id_or_key', retriable: false };
  }

  const url = `${BASE}?place_id=${encodeURIComponent(placeId)}&fields=name,rating,user_ratings_total,reviews&language=es&key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'network',
      retriable: true,
    };
  }

  if (res.status >= 500) {
    return { ok: false, error: `google_${res.status}`, retriable: true };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `google_${res.status}: ${t.slice(0, 200)}`, retriable: false };
  }

  const data = (await res.json()) as {
    status?: string;
    error_message?: string;
    result?: {
      name?: string;
      rating?: number;
      user_ratings_total?: number;
      reviews?: Array<{
        author_name?: string;
        rating?: number;
        text?: string;
        language?: string;
        time?: number;          // epoch seconds
      }>;
    };
  };

  // Google devuelve status='OK' | 'REQUEST_DENIED' | 'INVALID_REQUEST' | etc
  // en el body aún con HTTP 200.
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const retriable = data.status === 'UNKNOWN_ERROR' || data.status === 'OVER_QUERY_LIMIT';
    return {
      ok: false,
      error: `${data.status}: ${data.error_message ?? ''}`.slice(0, 200),
      retriable,
    };
  }

  const result = data.result;
  const rawReviews = result?.reviews ?? [];

  const reviews: GoogleReview[] = rawReviews
    .filter((r) => typeof r.rating === 'number' && typeof r.time === 'number')
    .map((r) => ({
      review_key: buildReviewKey(placeId, r.author_name || 'anon', r.time as number),
      reviewer_name: r.author_name ?? null,
      rating: r.rating as number,
      comment: (r.text && r.text.trim().length > 0) ? r.text.trim() : null,
      comment_lang: r.language ?? null,
      posted_at: new Date((r.time as number) * 1000).toISOString(),
    }));

  return {
    ok: true,
    place_name: result?.name ?? null,
    rating_avg: typeof result?.rating === 'number' ? result.rating : null,
    rating_count: typeof result?.user_ratings_total === 'number' ? result.user_ratings_total : null,
    reviews,
  };
}
