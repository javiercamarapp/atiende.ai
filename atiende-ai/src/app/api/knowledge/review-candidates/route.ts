import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function GET() {
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
      return NextResponse.json({ items: [], reviewedThisWeek: 0 });
    }

    // One week ago (Monday-based weeks would be nicer; rolling 7 days is simpler).
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: pending }, { count: reviewedThisWeek }] = await Promise.all([
      supabaseAdmin
        .from('review_candidates')
        .select('id, customer_message, bot_response, detection_reason, created_at')
        .eq('tenant_id', tenant.id)
        .eq('reviewed', false)
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('review_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('reviewed', true)
        .gte('reviewed_at', weekAgo),
    ]);

    return NextResponse.json({
      items: pending ?? [],
      reviewedThisWeek: reviewedThisWeek ?? 0,
    });
  } catch (err) {
    logger.error('[review-candidates] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
