import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCalendarWatch, stopCalendarWatch } from '@/lib/calendar/google';
import { logger } from '@/lib/logger';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Renews Google Calendar watch channels that expire within the next 24 hours.
 * Google channels max out at ~1 week; if we miss the renewal window the
 * subscription is lost and we fall back to the 60s revalidate polling.
 *
 * Called hourly by Vercel cron (see vercel.json).
 */
export async function GET(req: NextRequest) {
  // Audit fix: timing-safe comparison via shared helper. El `!==` original
  // permitía character-by-character timing attacks sobre CRON_SECRET.
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: expiring } = await supabaseAdmin
    .from('google_calendar_watch_channels')
    .select('id, tenant_id, staff_id, channel_id, resource_id, calendar_id')
    .lte('expiration_at', horizon);

  if (!expiring || expiring.length === 0) {
    return NextResponse.json({ renewed: 0, message: 'No channels near expiration.' });
  }

  if (!process.env.NEXT_PUBLIC_APP_URL) {
    logger.error('[cron/renew-watches] NEXT_PUBLIC_APP_URL missing', new Error('env missing'));
    return NextResponse.json({ error: 'env missing' }, { status: 500 });
  }

  let renewed = 0;
  let failed = 0;

  for (const row of expiring) {
    try {
      // Stop the old channel (best effort)
      try {
        await stopCalendarWatch({
          staffId: row.staff_id as string,
          channelId: row.channel_id as string,
          resourceId: row.resource_id as string,
        });
      } catch { /* ignore — may already be expired */ }

      // Open a new one
      const channelId = crypto.randomBytes(16).toString('hex');
      const token = crypto.randomBytes(24).toString('hex');
      const result = await startCalendarWatch({
        staffId: row.staff_id as string,
        calendarId: row.calendar_id as string,
        channelId,
        address: `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/webhook`,
        token,
        ttlSeconds: 7 * 24 * 60 * 60,
      });

      // Replace the row
      await supabaseAdmin
        .from('google_calendar_watch_channels')
        .update({
          channel_id: channelId,
          resource_id: result.resourceId,
          token,
          expiration_at: new Date(result.expiration).toISOString(),
        })
        .eq('id', row.id);

      renewed++;
    } catch (err) {
      failed++;
      logger.error(
        '[cron/renew-watches] renewal failed',
        err instanceof Error ? err : new Error(String(err)),
        { channel_row_id: row.id, staff_id: row.staff_id },
      );
      // Best effort: if Google totally rejects, drop the row so we re-create
      // on next user interaction.
      if (err instanceof Error && /(invalid|not_found|forbidden)/i.test(err.message)) {
        await supabaseAdmin
          .from('google_calendar_watch_channels')
          .delete()
          .eq('id', row.id);
      }
    }
  }

  return NextResponse.json({ renewed, failed, total: expiring.length });
}
