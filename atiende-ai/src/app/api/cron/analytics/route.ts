import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yS = `${yesterday}T00:00:00`;
    const yE = `${yesterday}T23:59:59`;

    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id,business_type,plan')
      .eq('status', 'active');

    for (const t of tenants || []) {
      const { count: mI } = await supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('direction', 'inbound').gte('created_at', yS).lte('created_at', yE);
      const { count: mO } = await supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('direction', 'outbound').gte('created_at', yS).lte('created_at', yE);
      const { count: hf } = await supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('sender_type', 'human').gte('created_at', yS).lte('created_at', yE);
      const { count: ab } = await supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('created_at', yS).lte('created_at', yE);

      await supabaseAdmin.from('daily_analytics').upsert(
        {
          tenant_id: t.id,
          date: yesterday,
          messages_inbound: mI || 0,
          messages_outbound: mO || 0,
          handoffs_human: hf || 0,
          appointments_booked: ab || 0,
        },
        { onConflict: 'tenant_id,date' },
      );
    }

    return NextResponse.json({ processed: tenants?.length || 0, date: yesterday });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
