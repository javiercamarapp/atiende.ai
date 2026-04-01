import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date().toISOString();

    // Clean expired quote cache entries
    const { data: deletedCache, error: cacheErr } = await supabaseAdmin
      .from('ins_quote_cache')
      .delete()
      .lt('expires_at', now)
      .select('id');

    if (cacheErr) {
      console.error('Error cleaning quote cache:', cacheErr);
    }

    const cacheCleanedCount = deletedCache?.length ?? 0;

    // Expire stale pending quote requests older than 24h
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredRequests, error: expireErr } = await supabaseAdmin
      .from('ins_quote_requests')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('created_at', twentyFourHoursAgo)
      .select('id');

    if (expireErr) {
      console.error('Error expiring stale requests:', expireErr);
    }

    const requestsExpiredCount = expiredRequests?.length ?? 0;

    return NextResponse.json({
      cache_cleaned: cacheCleanedCount,
      requests_expired: requestsExpiredCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
