import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notifyOwner } from '@/lib/actions/notifications';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export async function GET(request: NextRequest) {
  const authFail = requireCronAuth(request);
  if (authFail) return authFail;

  try {
    // Get all active tenants
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id, name, phone, wa_phone_number_id')
      .eq('status', 'active');

    if (!tenants?.length) return NextResponse.json({ sent: 0 });

    let sent = 0;
    const today = new Date().toISOString().split('T')[0];

    for (const tenant of tenants) {
      if (!tenant.phone || !tenant.wa_phone_number_id) continue;

      try {
        // Today's appointments
        const { count: appointmentsToday } = await supabaseAdmin
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('datetime', `${today}T00:00:00`)
          .lte('datetime', `${today}T23:59:59`)
          .in('status', ['scheduled', 'confirmed']);

        // Yesterday's messages
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const { count: messagesYesterday } = await supabaseAdmin
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('created_at', `${yesterday}T00:00:00`)
          .lte('created_at', `${yesterday}T23:59:59`);

        // Pending orders
        const { count: pendingOrders } = await supabaseAdmin
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('status', 'pending');

        // Hot leads
        const { count: hotLeads } = await supabaseAdmin
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('lead_temperature', 'hot');

        // Unresolved conversations
        const { count: activeConvs } = await supabaseAdmin
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('status', 'human_handoff');

        const briefing = `Buenos días. Su resumen de hoy:\n\n` +
          `📅 Citas hoy: ${appointmentsToday || 0}\n` +
          `💬 Mensajes ayer: ${messagesYesterday || 0}\n` +
          `🧾 Pedidos pendientes: ${pendingOrders || 0}\n` +
          `🔥 Leads calientes: ${hotLeads || 0}\n` +
          `👤 Conversaciones esperando: ${activeConvs || 0}\n\n` +
          `¡Que tenga un excelente día!`;

        await notifyOwner({
          tenantId: tenant.id,
          event: 'daily_summary',
          details: briefing,
        });
        sent++;
      } catch { /* skip tenant on error */ }
    }

    return NextResponse.json({ sent });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
