import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyUsage } from '@/lib/analytics/roi';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(_req: NextRequest) {
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

    const count = await getMonthlyUsage(tenant.id);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }
}
