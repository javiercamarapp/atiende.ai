import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let notified = 0;
  const errors: string[] = [];

  try {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Find active policies expiring within 30 days that haven't been notified
    const { data: policies, error: queryErr } = await supabaseAdmin
      .from('ins_policies')
      .select(`
        id,
        policy_number,
        end_date,
        tenant_id,
        contact_id,
        carrier_id,
        ins_carriers(name)
      `)
      .eq('status', 'active')
      .eq('renewal_notified', false)
      .lte('end_date', in30Days.toISOString())
      .gte('end_date', now.toISOString());

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    for (const policy of policies || []) {
      try {
        // Look up the tenant's WhatsApp phone number ID
        const { data: tenant } = await supabaseAdmin
          .from('tenants')
          .select('wa_phone_number_id')
          .eq('id', policy.tenant_id)
          .single();

        if (!tenant?.wa_phone_number_id) {
          errors.push(`Policy ${policy.id}: tenant missing wa_phone_number_id`);
          continue;
        }

        // Look up the contact's phone
        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .select('phone')
          .eq('id', policy.contact_id)
          .single();

        if (!contact?.phone) {
          errors.push(`Policy ${policy.id}: contact missing phone`);
          continue;
        }

        // Calculate days until expiration
        const daysUntilExpiry = Math.ceil(
          (new Date(policy.end_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        const carrierData = policy.ins_carriers as unknown as { name: string } | null;
        const carrierName = carrierData?.name ?? 'tu aseguradora';

        await sendTextMessage(
          tenant.wa_phone_number_id,
          contact.phone,
          `Tu póliza #${policy.policy_number} con ${carrierName} vence en ${daysUntilExpiry} días. ¿Quieres que re-cotice?`
        );

        // Mark as notified
        await supabaseAdmin
          .from('ins_policies')
          .update({ renewal_notified: true })
          .eq('id', policy.id);

        notified++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Policy ${policy.id}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ notified, errors: errors.length > 0 ? errors : undefined });
}
