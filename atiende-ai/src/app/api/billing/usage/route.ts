import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('direction', 'outbound')
      .eq('sender_type', 'bot')
      .gte('created_at', monthStart.toISOString());

    return NextResponse.json({ count: count ?? 0 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
