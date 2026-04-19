import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 10;

const PHONE_ID_REGEX = /^\d{10,20}$/;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:connect_wa`, 10, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const phoneNumberId = typeof body?.phoneNumberId === 'string'
      ? body.phoneNumberId.trim()
      : '';

    if (!PHONE_ID_REGEX.test(phoneNumberId)) {
      return NextResponse.json(
        { error: 'phoneNumberId debe contener entre 10 y 20 dígitos' },
        { status: 400 },
      );
    }

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: 'No encontramos tu agente. Completa el onboarding primero.' },
        { status: 404 },
      );
    }

    const { data: collision } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('wa_phone_number_id', phoneNumberId)
      .neq('id', tenant.id)
      .maybeSingle();

    if (collision) {
      return NextResponse.json(
        { error: 'Ese Phone Number ID ya está conectado a otro agente.' },
        { status: 409 },
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({
        wa_phone_number_id: phoneNumberId,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenant.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'No pudimos guardar el número. Inténtalo de nuevo.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, tenantId: tenant.id });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
