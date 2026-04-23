import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { trialEndingEmail } from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret — timing-safe.
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find tenants on trial plan created ~11 days ago (3 days before 14-day trial ends)
    const now = new Date();
    const elevenDaysAgo = new Date(now.getTime() - 11 * 24 * 60 * 60 * 1000);
    const twelveDaysAgo = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);

    const { data: trialTenants, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, email')
      .eq('plan', 'free_trial')
      .eq('status', 'active')
      .gte('created_at', twelveDaysAgo.toISOString())
      .lte('created_at', elevenDaysAgo.toISOString());

    if (error) {
      console.error('Trial warning query error:', error);
      return Response.json({ error: 'Query failed' }, { status: 500 });
    }

    let sent = 0;
    for (const tenant of trialTenants || []) {
      if (!tenant.email) continue;

      const { subject, html } = trialEndingEmail(tenant.name as string, 3);
      await sendEmail({
        to: tenant.email as string,
        subject,
        html,
      });
      sent++;
    }

    // Also check for tenants 1 day before trial ends (13 days old)
    const thirteenDaysAgo = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: urgentTenants } = await supabaseAdmin
      .from('tenants')
      .select('id, name, email')
      .eq('plan', 'free_trial')
      .eq('status', 'active')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lte('created_at', thirteenDaysAgo.toISOString());

    for (const tenant of urgentTenants || []) {
      if (!tenant.email) continue;

      const { subject, html } = trialEndingEmail(tenant.name as string, 1);
      await sendEmail({
        to: tenant.email as string,
        subject,
        html,
      });
      sent++;
    }

    return Response.json({
      success: true,
      sent,
      checked: (trialTenants?.length || 0) + (urgentTenants?.length || 0),
    });
  } catch (err) {
    console.error('Trial warning cron error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
