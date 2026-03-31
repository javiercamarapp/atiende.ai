import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createPortalSession } from '@/lib/billing/stripe';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    if (!tenant.stripe_customer_id) {
      return NextResponse.json({ error: 'No Stripe customer found. Please make a payment first.' }, { status: 400 });
    }

    const session = await createPortalSession(tenant.stripe_customer_id);
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
