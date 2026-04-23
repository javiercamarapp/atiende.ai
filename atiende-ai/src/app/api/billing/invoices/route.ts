import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { getStripe } from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await checkApiRateLimit(`${user.id}:billing_invoices`, 10, 60)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, stripe_customer_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenant?.stripe_customer_id) {
    return NextResponse.json({ invoices: [] });
  }

  try {
    const stripe = getStripe();
    const list = await stripe.invoices.list({
      customer: tenant.stripe_customer_id as string,
      limit: 50,
      status: 'paid',
    });

    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      date: inv.created,
      amount: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      pdf: inv.invoice_pdf,
      hosted_url: inv.hosted_invoice_url,
    }));

    return NextResponse.json({ invoices });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invoices_failed';
    console.error('[api/billing/invoices]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
