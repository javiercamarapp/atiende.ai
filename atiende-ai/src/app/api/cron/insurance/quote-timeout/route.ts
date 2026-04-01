import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Redis } from '@upstash/redis';
import type { QuoteProgress } from '@/lib/insurance/types';
import { REDIS_PROGRESS_TTL_SECONDS } from '@/lib/insurance/constants';

export const dynamic = 'force-dynamic';

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let timedOut = 0;
  let finalized = 0;

  try {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    // Find stale individual quotes (pending or running older than 3 minutes)
    const { data: staleQuotes, error: queryErr } = await supabaseAdmin
      .from('ins_quotes')
      .select('id, quote_request_id')
      .in('status', ['pending', 'running'])
      .lt('created_at', threeMinutesAgo);

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    // Collect unique request IDs that have timed-out quotes
    const affectedRequestIds = new Set<string>();

    for (const quote of staleQuotes || []) {
      await supabaseAdmin
        .from('ins_quotes')
        .update({ status: 'timeout', completed_at: new Date().toISOString() })
        .eq('id', quote.id);

      affectedRequestIds.add(quote.quote_request_id);
      timedOut++;
    }

    // For each affected request, check if all quotes are now non-pending
    const redis = getRedis();

    for (const requestId of affectedRequestIds) {
      const { data: allQuotes } = await supabaseAdmin
        .from('ins_quotes')
        .select('status, annual_premium, carrier_id, ins_carriers(name, slug)')
        .eq('quote_request_id', requestId);

      const quotes = allQuotes ?? [];
      const pending = quotes.filter(q => q.status === 'pending' || q.status === 'running');
      const succeeded = quotes.filter(q => q.status === 'success');
      const failed = quotes.filter(q =>
        ['error', 'timeout', 'skipped', 'declined'].includes(q.status)
      );

      if (pending.length === 0) {
        // Rank successful quotes
        const ranked = succeeded
          .sort((a, b) => (a.annual_premium ?? Infinity) - (b.annual_premium ?? Infinity));

        for (let i = 0; i < ranked.length; i++) {
          await supabaseAdmin.from('ins_quotes').update({
            rank_position: i + 1,
          }).eq('quote_request_id', requestId).eq('carrier_id', ranked[i].carrier_id);
        }

        // Finalize the request
        await supabaseAdmin.from('ins_quote_requests').update({
          status: 'complete',
          carriers_succeeded: succeeded.length,
          carriers_failed: failed.length,
          completed_at: new Date().toISOString(),
        }).eq('id', requestId);

        finalized++;
      }

      // Update Redis progress for SSE consumers
      const progress: QuoteProgress = {
        request_id: requestId,
        total: quotes.length,
        completed: succeeded.length,
        failed: failed.length,
        status: pending.length === 0 ? 'complete' : 'partial',
        results: succeeded
          .map(q => {
            const carrierData = q.ins_carriers as unknown as { name: string; slug: string } | null;
            return {
              carrier_name: carrierData?.name ?? '',
              carrier_slug: carrierData?.slug ?? '',
              annual_premium: q.annual_premium,
            };
          })
          .sort((a, b) => (a.annual_premium ?? Infinity) - (b.annual_premium ?? Infinity)),
        best_price: succeeded.length > 0
          ? Math.min(...succeeded.map(q => q.annual_premium ?? Infinity))
          : null,
      };

      await redis.set(
        `ins:progress:${requestId}`,
        JSON.stringify(progress),
        { ex: REDIS_PROGRESS_TTL_SECONDS }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ timed_out: timedOut, finalized });
}
