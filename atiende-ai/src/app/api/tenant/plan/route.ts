import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await checkApiRateLimit(`${user.id}:tenant_plan`, 30, 60)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('plan')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ plan: (tenant?.plan as string) || 'free_trial' });
}
