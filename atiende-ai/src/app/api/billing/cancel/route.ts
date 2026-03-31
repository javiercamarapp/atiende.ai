import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/billing/stripe';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, stripe_customer_id, plan')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    if (tenant.plan === 'free_trial') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    // Cancel active Stripe subscriptions
    if (tenant.stripe_customer_id) {
      const subscriptions = await stripe.subscriptions.list({
        customer: tenant.stripe_customer_id,
        status: 'active',
        limit: 10,
      });

      for (const sub of subscriptions.data) {
        await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: true,
        });
      }
    }

    // Update tenant status
    await supabaseAdmin
      .from('tenants')
      .update({ status: 'cancelled' })
      .eq('id', tenant.id);

    // Log the cancellation
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: tenant.id,
        user_id: user.id,
        action: 'subscription_cancelled',
        details: { previous_plan: tenant.plan },
      });
    } catch {
      // Non-critical: audit log failure should not break cancellation
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
