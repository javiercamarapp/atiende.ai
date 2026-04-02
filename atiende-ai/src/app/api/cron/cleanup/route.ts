import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET authorization (same pattern as other cron routes)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = logger.child({ job: 'cleanup' });
  const results: Record<string, unknown> = {};
  const start = Date.now();

  // ─── 1. Delete webhook_logs older than 30 days ────────────────────────
  try {
    const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('webhook_logs')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff30);

    if (error) throw error;
    results.webhookLogsDeleted = count ?? 0;
    log.info(`Deleted ${count ?? 0} webhook_logs older than 30 days`);
  } catch (err) {
    results.webhookLogsError = err instanceof Error ? err.message : 'unknown';
    log.error('Failed to clean webhook_logs', err instanceof Error ? err : undefined);
  }

  // ─── 2. Delete resolved conversations older than 90 days ─────────────
  try {
    const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('conversations')
      .delete({ count: 'exact' })
      .eq('status', 'resolved')
      .lt('updated_at', cutoff90);

    if (error) throw error;
    results.resolvedConversationsDeleted = count ?? 0;
    log.info(`Deleted ${count ?? 0} resolved conversations older than 90 days`);
  } catch (err) {
    // Table or column may not exist — that's acceptable
    results.resolvedConversationsError = err instanceof Error ? err.message : 'unknown';
    log.warn('Could not clean resolved conversations (table may not exist)', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  // ─── 3. Record this cron run ─────────────────────────────────────────
  try {
    await supabaseAdmin.from('cron_runs').insert({
      job_name: 'cleanup',
      result: results,
    });
  } catch {
    // cron_runs table may not exist yet — non-critical
  }

  const durationMs = Date.now() - start;
  log.info('Cleanup cron completed', { durationMs, ...results });

  return NextResponse.json({
    status: 'ok',
    durationMs,
    results,
  });
}
