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
      const { count: noShow } = await supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('status', 'no_show').gte('datetime', yS).lte('datetime', yE);
      const { count: cancelled } = await supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('status', 'cancelled').gte('datetime', yS).lte('datetime', yE);
      const { data: orders } = await supabaseAdmin.from('orders').select('total').eq('tenant_id', t.id).gte('created_at', yS).lte('created_at', yE);
      const ordersRevenue = (orders || []).reduce((sum, o) => sum + Number(o.total || 0), 0);
      const { count: ordersTotal } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('created_at', yS).lte('created_at', yE);
      const { count: newConvs } = await supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('created_at', yS).lte('created_at', yE);
      const { data: costs } = await supabaseAdmin.from('messages').select('cost_usd').eq('tenant_id', t.id).gte('created_at', yS).lte('created_at', yE).not('cost_usd', 'is', null);
      const llmCost = (costs || []).reduce((sum, m) => sum + Number(m.cost_usd || 0), 0);
      const msgsSaved = (mI || 0);
      const minSaved = msgsSaved * 2.5;

      await supabaseAdmin.from('daily_analytics').upsert(
        {
          tenant_id: t.id,
          date: yesterday,
          conversations_new: newConvs || 0,
          messages_inbound: mI || 0,
          messages_outbound: mO || 0,
          handoffs_human: hf || 0,
          appointments_booked: ab || 0,
          appointments_no_show: noShow || 0,
          appointments_cancelled: cancelled || 0,
          orders_total: ordersTotal || 0,
          orders_revenue: ordersRevenue,
          llm_cost_usd: llmCost,
          messages_saved: msgsSaved,
          minutes_saved: minSaved,
        },
        { onConflict: 'tenant_id,date' },
      );
    }

    return NextResponse.json({ processed: tenants?.length || 0, date: yesterday });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
