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

function errRedirect(reason: string, detail?: string) {
  const base = `${process.env.NEXT_PUBLIC_APP_URL}/calendar?calendar_error=${reason}`;
  const url = detail ? `${base}&detail=${encodeURIComponent(detail.slice(0, 200))}` : base;
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.delete('oauth_state');
  response.cookies.delete('oauth_code_verifier');
  return response;
}

// GET without code param = initiate OAuth flow
// GET with code param = callback from Google
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !process.env.NEXT_PUBLIC_APP_URL) {
      return errRedirect('env_missing', 'GOOGLE_CLIENT_ID/SECRET or NEXT_PUBLIC_APP_URL not set');
    }

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

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
      // include_granted_scopes so Google does NOT replace a prior grant silently
      include_granted_scopes: true,
    });

    const response = NextResponse.redirect(authUrl);
    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      maxAge: 600,
      // Path '/' so the cookies survive the cross-site round-trip through
      // Google. Safari/Brave strip cookies with narrow paths in some cases.
      path: '/',
    };
    response.cookies.set('oauth_state', state, cookieOpts);
    response.cookies.set('oauth_code_verifier', codeVerifier, cookieOpts);
    return response;
  }

  // Handle OAuth callback
  try {
    const stateParam = req.nextUrl.searchParams.get('state');
    const stateCookie = req.cookies.get('oauth_state')?.value;

    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      console.error('[calendar-connect] CSRF check failed', {
        hasParam: !!stateParam,
        hasCookie: !!stateCookie,
        match: stateParam === stateCookie,
      });
      return errRedirect('invalid_state');
    }

    const codeVerifier = req.cookies.get('oauth_code_verifier')?.value;
    if (!codeVerifier) {
      console.error('[calendar-connect] PKCE verifier cookie missing');
      return errRedirect('missing_verifier');
    }

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

    // Resolve tenant first so we can reuse an existing refresh token if Google
    // refuses to issue a new one (happens when the user previously granted but
    // the 'consent' prompt was satisfied by an existing session).
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      console.error('[calendar-connect] no tenant for user', { userId: user.id });
      return errRedirect('no_tenant');
    }

    let refreshToken: string | null = tokens.refresh_token || null;

    if (!refreshToken) {
      // Try to keep a previously saved one so the user is not stuck. If there
      // is nothing saved either, ask the user to revoke access and try again.
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
      // Keep the existing token; still update calendar id below.
    }

    // Get primary calendar ID (use the access token we just received)
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

    if (existingStaff?.id) {
      const { error: updateErr } = await supabaseAdmin
        .from('staff')
        .update(updates)
        .eq('id', existingStaff.id);
      if (updateErr) {
        console.error('[calendar-connect] staff update failed', updateErr);
        return errRedirect('db_update_failed', updateErr.message);
      }
    } else {
      const { error: insertErr } = await supabaseAdmin
        .from('staff')
        .insert({
          tenant_id: tenant.id,
          name: (tenant.name as string) || 'Titular',
          ...updates,
        });
      if (insertErr) {
        console.error('[calendar-connect] staff insert failed', insertErr);
        return errRedirect('db_insert_failed', insertErr.message);
      }
    }

    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar?calendar=connected`,
      { status: 303 },
    );
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_code_verifier');
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calendar-connect] unhandled OAuth error', { message });
    return errRedirect('calendar_failed', message);
  }
}
