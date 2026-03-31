import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTemplate } from '@/lib/whatsapp/send';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET authorization
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const in24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in23 = new Date(now.getTime() + 23 * 60 * 60 * 1000);

  let sent24h = 0;
  let sent1h = 0;

  // ═══ 24-HOUR REMINDERS ═══
  try {
    const { data: a24 } = await supabaseAdmin
      .from('appointments')
      .select('*, tenants(wa_phone_number_id, wa_token, name)')
      .gte('datetime', in23.toISOString())
      .lte('datetime', in24.toISOString())
      .eq('status', 'scheduled')
      .eq('reminder_24h_sent', false);

    for (const appt of a24 || []) {
      try {
        const tenant = appt.tenants as any;
        await sendTemplate(
          tenant.wa_phone_number_id,
          appt.customer_phone,
          'appointment_reminder_24h',
          [appt.customer_name || 'Cliente', tenant.name, new Date(appt.datetime).toLocaleString('es-MX')]
        );
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_24h_sent: true })
          .eq('id', appt.id);
        sent24h++;
      } catch (err) {
        console.error(`Error sending 24h reminder for appointment ${appt.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Error querying 24h appointments:', err);
  }

  // ═══ 1-HOUR REMINDERS ═══
  try {
    const in1 = new Date(now.getTime() + 60 * 60 * 1000);
    const { data: a1 } = await supabaseAdmin
      .from('appointments')
      .select('*, tenants(wa_phone_number_id, wa_token, name)')
      .gte('datetime', now.toISOString())
      .lte('datetime', in1.toISOString())
      .in('status', ['scheduled', 'confirmed'])
      .eq('reminder_1h_sent', false);

    for (const appt of a1 || []) {
      try {
        const tenant = appt.tenants as any;
        await sendTemplate(
          tenant.wa_phone_number_id,
          appt.customer_phone,
          'appointment_reminder_1h',
          [appt.customer_name || 'Cliente', tenant.name, new Date(appt.datetime).toLocaleString('es-MX')]
        );
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_1h_sent: true })
          .eq('id', appt.id);
        sent1h++;
      } catch (err) {
        console.error(`Error sending 1h reminder for appointment ${appt.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Error querying 1h appointments:', err);
  }

  return NextResponse.json({ sent24h, sent1h });
}
