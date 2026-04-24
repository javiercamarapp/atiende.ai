-- Google Calendar push-notification subscriptions.
-- Each time we call calendar.events.watch on a staff's primary calendar, Google
-- returns a channel_id + resource_id + expiration. We store those so:
--   1) Incoming webhook payloads (which carry channel_id in headers) can be
--      mapped to the owner staff/tenant.
--   2) A cron can pre-emptively renew channels that expire within 24h.

CREATE TABLE IF NOT EXISTS google_calendar_watch_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  token TEXT,
  expiration_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_watch_staff ON google_calendar_watch_channels (staff_id);
CREATE INDEX IF NOT EXISTS idx_google_watch_expiration ON google_calendar_watch_channels (expiration_at);

ALTER TABLE google_calendar_watch_channels ENABLE ROW LEVEL SECURITY;

-- Only the service role can read/write — the webhook handler uses admin client.
CREATE POLICY "service_role_all_watch" ON google_calendar_watch_channels
  FOR ALL
  USING (false)
  WITH CHECK (false);
