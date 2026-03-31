import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import type { AgentContext } from '../engine';

export async function runNPS(ctx: AgentContext) {
  const { sendButtonMessage } = await import('@/lib/whatsapp/send');
  const payload = ctx.config.eventPayload as Record<string, string> | undefined;
  const phone = payload?.customer_phone;
  const name = payload?.customer_name || '';
  if (!phone) return;

  await sendButtonMessage(
    ctx.tenant.wa_phone_number_id as string,
    phone,
    `Hola ${name}, ¿cómo calificaría su experiencia en ${ctx.tenant.name}?`,
    [
      '⭐ Excelente (9-10)',
      '👍 Buena (7-8)',
      '😐 Podemos mejorar',
    ]
  );
}

export async function runReportes(ctx: AgentContext) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: analytics } = await supabaseAdmin
    .from('daily_analytics')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .gte('date', weekAgo);

  if (!analytics?.length) return;

  const totals = analytics.reduce((acc, d) => ({
    msgs: acc.msgs + (d.messages_inbound || 0) + (d.messages_outbound || 0),
    appointments: acc.appointments + (d.appointments_booked || 0),
    noShows: acc.noShows + (d.appointments_no_show || 0),
    revenue: acc.revenue + Number(d.orders_revenue || 0),
    saved: acc.saved + Number(d.estimated_savings_mxn || 0),
  }), { msgs: 0, appointments: 0, noShows: 0, revenue: 0, saved: 0 });

  const report = `📈 Reporte semanal de ${ctx.tenant.name}:\n\n` +
    `💬 Mensajes: ${totals.msgs}\n` +
    `📅 Citas agendadas: ${totals.appointments}\n` +
    `❌ No-shows: ${totals.noShows}\n` +
    `💰 Revenue: $${totals.revenue.toLocaleString()} MXN\n` +
    `✅ Ahorro estimado: $${totals.saved.toLocaleString()} MXN`;

  if (ctx.tenant.phone) {
    await sendTextMessage(ctx.tenant.wa_phone_number_id as string, ctx.tenant.phone as string, report);
  }
}

export async function runFAQBuilder(ctx: AgentContext) {
  const { data: lowConf } = await supabaseAdmin
    .from('messages')
    .select('content, intent')
    .eq('tenant_id', ctx.tenantId)
    .eq('direction', 'inbound')
    .lt('confidence', 0.5)
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(50);

  if (!lowConf?.length) return;

  await supabaseAdmin.from('audit_log').insert({
    tenant_id: ctx.tenantId,
    action: 'faq_builder.gaps_detected',
    entity_type: 'knowledge_chunks',
    details: { count: lowConf.length, samples: lowConf.slice(0, 10).map(m => m.content) },
  });
}

export async function runRendimientoStaff(ctx: AgentContext) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: staff } = await supabaseAdmin
    .from('staff')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true);

  if (!staff?.length) return;

  const lines: string[] = [];
  for (const s of staff) {
    const { count } = await supabaseAdmin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', s.id)
      .gte('created_at', weekAgo);

    lines.push(`• ${s.name}: ${count || 0} citas`);
  }

  const report = `👥 Rendimiento semanal:\n\n${lines.join('\n')}`;
  if (ctx.tenant.phone) {
    await sendTextMessage(ctx.tenant.wa_phone_number_id as string, ctx.tenant.phone as string, report);
  }
}
