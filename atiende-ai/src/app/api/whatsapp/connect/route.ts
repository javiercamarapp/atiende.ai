import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { code } = await request.json();
    if (!code) return NextResponse.json({ error: 'Missing OAuth code' }, { status: 400 });

    // Exchange code for access token with Meta
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.WA_APP_SECRET}&code=${code}`,
      { method: 'GET' }
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'Failed to exchange code' }, { status: 400 });
    }

    // Get WhatsApp Business Account info
    const wabaRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${tokenData.access_token}&access_token=${process.env.META_APP_ID}|${process.env.WA_APP_SECRET}`,
      { method: 'GET' }
    );
    const wabaData = await wabaRes.json();

    // Get phone number from shared WABAs
    const sharedRes = await fetch(
      `https://graph.facebook.com/v21.0/me/businesses?access_token=${tokenData.access_token}`,
      { method: 'GET' }
    );
    const sharedData = await sharedRes.json();

    // For now, return the token and let the frontend store the phone_number_id
    // In production, you'd query the WABA for phone numbers
    void sharedData;
    return NextResponse.json({
      success: true,
      access_token: tokenData.access_token,
      phone_number_id: wabaData?.data?.granular_scopes?.[0]?.target_ids?.[0] || null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
