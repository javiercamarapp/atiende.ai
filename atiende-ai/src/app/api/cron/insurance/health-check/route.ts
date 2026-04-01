import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CarrierHealthStatus } from '@/lib/insurance/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Array<{ carrier: string; status: CarrierHealthStatus; latency_ms: number }> = [];

  try {
    const { data: carriers, error: queryErr } = await supabaseAdmin
      .from('ins_carriers')
      .select('id, slug, name, portal_url')
      .eq('is_active', true);

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    for (const carrier of carriers || []) {
      let healthStatus: CarrierHealthStatus = 'down';
      let latencyMs = 0;
      let errorMessage: string | null = null;
      let httpStatus: number | null = null;

      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(carrier.portal_url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);
        latencyMs = Date.now() - start;
        httpStatus = response.status;

        if (response.ok || response.status === 405 || response.status === 302) {
          // 405 = Method Not Allowed (HEAD not supported but server is up)
          // 302 = Redirect (portal is up, just redirecting)
          healthStatus = latencyMs > 5000 ? 'degraded' : 'healthy';
        } else if (response.status >= 500) {
          healthStatus = 'down';
        } else {
          // 4xx responses still mean the server is reachable
          healthStatus = 'degraded';
        }
      } catch (err) {
        latencyMs = 0;
        healthStatus = 'down';
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      // Log to health log table
      await supabaseAdmin
        .from('ins_carrier_health_log')
        .insert({
          carrier_id: carrier.id,
          status: healthStatus,
          latency_ms: latencyMs,
          http_status: httpStatus,
          error_message: errorMessage,
        });

      // Calculate failure_rate_24h from recent health log entries
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { count: totalChecks } = await supabaseAdmin
        .from('ins_carrier_health_log')
        .select('*', { count: 'exact', head: true })
        .eq('carrier_id', carrier.id)
        .gte('created_at', twentyFourHoursAgo);

      const { count: failedChecks } = await supabaseAdmin
        .from('ins_carrier_health_log')
        .select('*', { count: 'exact', head: true })
        .eq('carrier_id', carrier.id)
        .eq('status', 'down')
        .gte('created_at', twentyFourHoursAgo);

      const failureRate = totalChecks && totalChecks > 0
        ? Number(((failedChecks ?? 0) / totalChecks * 100).toFixed(1))
        : 0;

      // Update carrier record
      await supabaseAdmin
        .from('ins_carriers')
        .update({
          health_status: healthStatus,
          failure_rate_24h: failureRate,
          last_health_check: new Date().toISOString(),
        })
        .eq('id', carrier.id);

      results.push({ carrier: carrier.slug, status: healthStatus, latency_ms: latencyMs });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ checked: results.length, results });
}
