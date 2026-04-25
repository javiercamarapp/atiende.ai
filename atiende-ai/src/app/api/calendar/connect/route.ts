import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import crypto from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptPII } from '@/lib/utils/crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/connect`;

// ─── Signed state (no cookies needed) ───────────────────────────────────────
// We pack a nonce, the PKCE verifier and issued-at into the OAuth state
// parameter itself, signed with HMAC-SHA256 keyed by the server's encryption
// key. This removes the dependency on cookies surviving the cross-site round
// trip through Google (which Safari / Brave / Firefox-Strict love to strip).

/**
 * Strong key para firmar state OAuth. Antes había un fallback débil
 * a `'atiende-oauth-state-fallback'` (string público) que volvía
 * el HMAC trivial de falsificar si las env vars desaparecían.
 *
 * Ahora: requerimos hex32 de MESSAGES_ENCRYPTION_KEY/PII_ENCRYPTION_KEY,
 * o un CRON_SECRET de >=32 chars. Si nada cumple, lanza en runtime —
 * el handler responde 500 antes de iniciar el flujo OAuth (mejor
 * fallar visible que aceptar state forjable).
 */
function stateSecret(): Buffer {
  const hex = process.env.MESSAGES_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY;
  if (hex && hex.length === 64) {
    try {
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) return buf;
    } catch { /* fallthrough */ }
  }
  const cron = process.env.CRON_SECRET;
  if (cron && cron.length >= 32) {
    return Buffer.from(cron);
  }
  throw new Error(
    'OAuth state requires MESSAGES_ENCRYPTION_KEY (hex32) or CRON_SECRET (>=32 chars). ' +
      'Configure env vars before enabling Google Calendar integration.',
  );
}

interface StatePayload {
  n: string;  // nonce
  v: string;  // PKCE verifier
  t: number;  // issued at ms
}

function signState(payload: StatePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', stateSecret()).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verifyState(state: string): StatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [data, mac] = parts;
  const expected = crypto.createHmac('sha256', stateSecret()).update(data).digest('base64url');
  const expectedBuf = Buffer.from(expected);
  const macBuf = Buffer.from(mac);
  if (expectedBuf.length !== macBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, macBuf)) return null;
  try {
    const json = Buffer.from(data, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as StatePayload;
    if (typeof parsed.n !== 'string' || typeof parsed.v !== 'string' || typeof parsed.t !== 'number') {
      return null;
    }
    // 10-minute window
    if (Date.now() - parsed.t > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function errRedirect(reason: string, detail?: string) {
  const base = `${process.env.NEXT_PUBLIC_APP_URL}/calendar?calendar_error=${reason}`;
  const url = detail ? `${base}&detail=${encodeURIComponent(detail.slice(0, 200))}` : base;
  return NextResponse.redirect(url, { status: 303 });
}

// GET without code param = initiate OAuth flow
// GET with code param = callback from Google
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !process.env.NEXT_PUBLIC_APP_URL) {
      return errRedirect('env_missing', 'GOOGLE_CLIENT_ID/SECRET or NEXT_PUBLIC_APP_URL not set');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const state = signState({ n: nonce, v: codeVerifier, t: Date.now() });

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI,
    );

    const scopes = ['https://www.googleapis.com/auth/calendar'];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      include_granted_scopes: true,
    });

    return NextResponse.redirect(authUrl);
  }

  // Handle OAuth callback
  try {
    const stateParam = req.nextUrl.searchParams.get('state');
    if (!stateParam) {
      console.error('[calendar-connect] missing state on callback');
      return errRedirect('invalid_state', 'missing_state_param');
    }

    const payload = verifyState(stateParam);
    if (!payload) {
      console.error('[calendar-connect] state signature invalid or expired');
      return errRedirect('invalid_state', 'signature_or_expiry_failed');
    }

    const codeVerifier = payload.v;

    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      console.error('[calendar-connect] Supabase session missing on callback', { authError });
      return errRedirect('unauthorized');
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI,
    );

    const { tokens } = await oauth2Client.getToken({ code, codeVerifier });

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      console.error('[calendar-connect] no tenant for user', { userId: user.id });
      return errRedirect('no_tenant');
    }

    const refreshToken: string | null = tokens.refresh_token || null;

    if (!refreshToken) {
      const { data: staffWithToken } = await supabaseAdmin
        .from('staff')
        .select('id, google_refresh_token')
        .eq('tenant_id', tenant.id)
        .not('google_refresh_token', 'is', null)
        .limit(1)
        .maybeSingle();

      if (!staffWithToken?.google_refresh_token) {
        console.error('[calendar-connect] Google returned no refresh_token and none stored');
        return errRedirect(
          'no_refresh_token',
          'Revoke access at https://myaccount.google.com/permissions and try again',
        );
      }
    }

    oauth2Client.setCredentials(tokens);
    let calendarId = 'primary';
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const { data: calendarList } = await calendar.calendarList.list();
      const primary = calendarList.items?.find((c) => c.primary);
      calendarId = primary?.id || 'primary';
    } catch (err) {
      console.warn('[calendar-connect] could not list calendars, defaulting to primary', err);
    }

    const updates: { google_calendar_id: string; google_refresh_token?: string } = {
      google_calendar_id: calendarId,
    };
    if (refreshToken) {
      const encrypted = encryptPII(refreshToken);
      if (encrypted) updates.google_refresh_token = encrypted;
    }

    const { data: existingStaff } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let resolvedStaffId: string | null = null;
    if (existingStaff?.id) {
      const { error: updateErr } = await supabaseAdmin
        .from('staff')
        .update(updates)
        .eq('id', existingStaff.id);
      if (updateErr) {
        console.error('[calendar-connect] staff update failed', updateErr);
        return errRedirect('db_update_failed', updateErr.message);
      }
      resolvedStaffId = existingStaff.id as string;
    } else {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('staff')
        .insert({
          tenant_id: tenant.id,
          name: (tenant.name as string) || 'Titular',
          ...updates,
        })
        .select('id')
        .single();
      if (insertErr) {
        console.error('[calendar-connect] staff insert failed', insertErr);
        return errRedirect('db_insert_failed', insertErr.message);
      }
      resolvedStaffId = (inserted?.id as string) || null;
    }

    // Register a Google push-notification channel so event changes are
    // mirrored into Atiende in near real-time (no 60s revalidate gap).
    // Best effort: if it fails we still have the 60s polling fallback.
    if (resolvedStaffId && process.env.NEXT_PUBLIC_APP_URL) {
      try {
        const { startCalendarWatch } = await import('@/lib/calendar/google');
        const channelId = crypto.randomBytes(16).toString('hex');
        const token = crypto.randomBytes(24).toString('hex');
        const result = await startCalendarWatch({
          staffId: resolvedStaffId,
          calendarId,
          channelId,
          address: `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/webhook`,
          token,
          ttlSeconds: 7 * 24 * 60 * 60,
        });
        await supabaseAdmin
          .from('google_calendar_watch_channels')
          .insert({
            tenant_id: tenant.id,
            staff_id: resolvedStaffId,
            channel_id: channelId,
            resource_id: result.resourceId,
            calendar_id: calendarId,
            token,
            expiration_at: new Date(result.expiration).toISOString(),
          });
      } catch (err) {
        console.warn('[calendar-connect] watch registration failed (sync falls back to polling)', err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar?calendar=connected`,
      { status: 303 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calendar-connect] unhandled OAuth error', { message });
    return errRedirect('calendar_failed', message);
  }
}
