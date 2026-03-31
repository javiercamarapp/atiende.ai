import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/connect`
);

// GET without code param = initiate OAuth flow
// GET with code param = callback from Google
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    // Initiate OAuth2 flow
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
    return NextResponse.redirect(authUrl);
  }

  // Handle OAuth callback
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=unauthorized`
      );
    }

    const { tokens } = await oauth2Client.getToken(code);

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
      await supabaseAdmin
        .from('staff')
        .update({
          google_calendar_id: calendarId,
          google_refresh_token: tokens.refresh_token,
        })
        .eq('tenant_id', tenant.id)
        .eq('user_id', user.id);
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?calendar=connected`
    );
  } catch (err) {
    console.error('[calendar-connect] OAuth error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=calendar_failed`
    );
  }
}
