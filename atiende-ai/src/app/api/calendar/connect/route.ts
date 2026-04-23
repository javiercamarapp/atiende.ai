import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import crypto from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptPII } from '@/lib/utils/crypto';

// Keep credentials at module scope, but instantiate OAuth2Client per-request
// to avoid race conditions when multiple tenants do OAuth simultaneously.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/connect`;

// GET without code param = initiate OAuth flow
// GET with code param = callback from Google
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    // Initiate OAuth2 flow

    // --- CSRF: generate random state and store in cookie ---
    const state = crypto.randomBytes(32).toString('hex');

    // --- PKCE: generate code_verifier and code_challenge ---
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
    });

    const response = NextResponse.redirect(authUrl);

    // Store state in httpOnly cookie for CSRF verification on callback
    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/api/calendar/connect',
    });

    // Store PKCE code_verifier in cookie for token exchange on callback
    response.cookies.set('oauth_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600,
      path: '/api/calendar/connect',
    });

    return response;
  }

  // Handle OAuth callback
  try {
    // --- CSRF: verify state parameter matches cookie ---
    const stateParam = req.nextUrl.searchParams.get('state');
    const stateCookie = req.cookies.get('oauth_state')?.value;

    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=invalid_state`,
        { status: 303 },
      );
    }

    // --- PKCE: retrieve code_verifier from cookie ---
    const codeVerifier = req.cookies.get('oauth_code_verifier')?.value;

    if (!codeVerifier) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_verifier`,
        { status: 303 },
      );
    }

    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=unauthorized`
      );
    }

    // Create a per-request OAuth2Client to avoid race conditions
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI,
    );

    // Exchange code for tokens, passing the PKCE code_verifier
    const { tokens } = await oauth2Client.getToken({
      code,
      codeVerifier,
    });

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=no_refresh_token`
      );
    }

    // Get primary calendar ID
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const { data: calendarList } = await calendar.calendarList.list();
    const primaryCalendar = calendarList.items?.find(c => c.primary);
    const calendarId = primaryCalendar?.id || 'primary';

    // Store refresh token and calendar ID for the staff member
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (tenant) {
      // Encrypt the refresh token before storing
      const encryptedRefreshToken = encryptPII(tokens.refresh_token);

      await supabaseAdmin
        .from('staff')
        .update({
          google_calendar_id: calendarId,
          google_refresh_token: encryptedRefreshToken,
        })
        .eq('tenant_id', tenant.id)
        .eq('user_id', user.id);
    }

    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?calendar=connected`
    );

    // Delete the OAuth cookies after successful verification
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_code_verifier');

    return response;
  } catch (err) {
    console.error('[calendar-connect] OAuth error:', err instanceof Error ? err.message : err);
    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=calendar_failed`
    );

    // Clean up cookies even on error
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_code_verifier');

    return response;
  }
}
