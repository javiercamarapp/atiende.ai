import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export async function POST() {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ notifications_read_at: new Date().toISOString() })
      .eq('id', tenant.id);

    if (error) {
      logger.error('[notifications/mark-read] update failed', new Error(error.message), {
        tenant_id: tenant.id,
      });
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error(
      '[notifications/mark-read] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
