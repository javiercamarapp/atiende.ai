import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * Google Calendar push notifications.
 *
 * When a watched calendar changes, Google POSTs to this endpoint with headers:
 *   x-goog-channel-id:     our channel_id (issued at watch time)
 *   x-goog-resource-id:    the resource being observed
 *   x-goog-resource-state: 'sync' (initial) | 'exists' | 'not_exists'
 *   x-goog-channel-token:  the token we gave it at watch time (validates auth)
 *   x-goog-message-number: monotonically increasing
 *
 * Body is empty by design — this is just a ping. We:
 *   1) Validate the token matches the channel row
 *   2) Ignore the initial 'sync' ping
 *   3) Revalidate the /calendar path so next visit refetches events
 *
 * We deliberately do NOT fetch Google events here: the Next revalidate plus
 * the existing 60s revalidate guarantees freshness while avoiding a per-
 * notification API call storm during bulk changes.
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get('x-goog-channel-id');
  const resourceState = req.headers.get('x-goog-resource-state');
  const token = req.headers.get('x-goog-channel-token');

  if (!channelId) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const { data: channel } = await supabaseAdmin
      .from('google_calendar_watch_channels')
      .select('id, tenant_id, token')
      .eq('channel_id', channelId)
      .maybeSingle();

    if (!channel) {
      // Channel not registered (stale / forged) — acknowledge but do nothing.
      return new NextResponse(null, { status: 200 });
    }

    if (channel.token && token && channel.token !== token) {
      logger.warn('[calendar-webhook] token mismatch', { channelId });
      return new NextResponse(null, { status: 401 });
    }

    // Sync/initial pings carry no event change info — just acknowledge.
    if (resourceState === 'sync') {
      return new NextResponse(null, { status: 200 });
    }

    // Invalidate the cached /calendar server render so the next visit sees fresh
    // Google events immediately. Safe to call repeatedly.
    try {
      revalidatePath('/calendar');
    } catch { /* best effort */ }

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    logger.error(
      '[calendar-webhook] handler error',
      err instanceof Error ? err : new Error(String(err)),
      { channelId },
    );
    // Return 200 anyway — Google retries aggressively on non-2xx.
    return new NextResponse(null, { status: 200 });
  }
}

// Google doesn't GET this endpoint, but some providers probe it. 200 no-op.
export async function GET() {
  return NextResponse.json({ ok: true });
}
