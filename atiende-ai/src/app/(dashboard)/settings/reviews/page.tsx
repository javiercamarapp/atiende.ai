// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD — /settings/reviews (Phase 3)
//
// Lista las reseñas de Google sincronizadas por el cron google-reviews-sync.
// El dueño puede verlas, filtrar por rating, y (future) responder desde acá.
// Si el tenant no tiene google_place_id configurado, muestra CTA para ir a
// /settings/locations y setearlo.
// ═════════════════════════════════════════════════════════════════════════════

import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { SyncReviewsButton } from '@/components/dashboard/sync-reviews-button';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, google_place_id, google_reviews_last_sync_at, google_reviews_last_count')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return null;

  const { data: reviews } = await supabase
    .from('google_reviews')
    .select('id, reviewer_name, rating, comment, comment_lang, posted_at, owner_replied, owner_replied_at')
    .eq('tenant_id', tenant.id)
    .order('posted_at', { ascending: false })
    .limit(50);

  const rs = reviews || [];
  const avg = rs.length > 0
    ? Math.round((rs.reduce((s, r) => s + (r.rating as number), 0) / rs.length) * 10) / 10
    : null;
  const buckets = [5, 4, 3, 2, 1].map((r) => ({
    rating: r,
    count: rs.filter((x) => x.rating === r).length,
  }));

  return (
    <div className="max-w-3xl mx-auto p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Reseñas de Google</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Sincronizado automáticamente una vez por semana. Las últimas 5 reseñas visibles en Google.
          </p>
        </div>
        {tenant.google_place_id && <SyncReviewsButton />}
      </header>

      {!tenant.google_place_id ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-900">Configurá tu ID de Google Places</h2>
          <p className="text-sm text-amber-800 mt-1 leading-relaxed">
            Para importar reseñas necesitamos el <strong>Place ID</strong> de tu consultorio.
            Podés buscarlo en{' '}
            <a
              href="https://developers.google.com/maps/documentation/places/web-service/place-id"
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              la herramienta de Google
            </a>
            {' '}y guardarlo en tu configuración.
          </p>
          <Link
            href="/settings/locations"
            className="inline-block mt-3 px-4 py-2 bg-[hsl(var(--brand-blue))] text-white rounded-lg text-sm font-medium"
          >
            Configurar Place ID
          </Link>
        </div>
      ) : rs.length === 0 ? (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <p className="text-sm text-zinc-600">
            Todavía no hay reseñas sincronizadas. La próxima sincronización corre automáticamente.
          </p>
          {tenant.google_reviews_last_sync_at && (
            <p className="text-xs text-zinc-400 mt-1">
              Última ejecución: {new Date(tenant.google_reviews_last_sync_at as string).toLocaleString('es-MX')}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white border border-zinc-100 rounded-xl p-5 mb-5">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-zinc-900">{avg?.toFixed(1) ?? '—'}</span>
              <span className="text-sm text-zinc-500">promedio de las últimas {rs.length}</span>
            </div>
            <div className="mt-3 space-y-1">
              {buckets.map((b) => (
                <div key={b.rating} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-zinc-500">{b.rating}★</span>
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: rs.length === 0 ? '0%' : `${(b.count / rs.length) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-zinc-500">{b.count}</span>
                </div>
              ))}
            </div>
            {tenant.google_reviews_last_sync_at && (
              <p className="text-xs text-zinc-400 mt-3">
                Última sincronización:{' '}
                {new Date(tenant.google_reviews_last_sync_at as string).toLocaleString('es-MX')}
              </p>
            )}
          </div>

          <ul className="space-y-3">
            {rs.map((r) => (
              <li key={r.id as string} className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {r.reviewer_name || 'Anónimo'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {new Date(r.posted_at as string).toLocaleDateString('es-MX', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="text-amber-500 text-sm">
                    {'★'.repeat(r.rating as number)}
                    <span className="text-zinc-200">{'★'.repeat(5 - (r.rating as number))}</span>
                  </div>
                </div>
                {r.comment && (
                  <p className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">
                    {r.comment}
                  </p>
                )}
                {r.owner_replied && (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Respondida {r.owner_replied_at ? `el ${new Date(r.owner_replied_at as string).toLocaleDateString('es-MX')}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
