import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/billing/stripe';
import { createOxxoPayment, createSpeiPayment } from '@/lib/billing/conekta';
import { createServerSupabase } from '@/lib/supabase/server';
import { z } from 'zod';

const CheckoutSchema = z.object({
  plan: z.enum(['basic', 'pro', 'premium']),
  method: z.enum(['stripe', 'oxxo', 'spei']),
  email: z.string().email(),
  name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const tenantId = tenant.id;
    const body = await req.json();
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }
    const { email, plan, method, name = '' } = parsed.data;

    if (method === 'stripe') {
      const s = await createCheckoutSession(tenantId, email, plan);
      return NextResponse.json({ url: s.url });
    }
    if (method === 'oxxo') {
      const r = await createOxxoPayment(tenantId, email || '', plan, name || '');
      return NextResponse.json(r);
    }
    if (method === 'spei') {
      const r = await createSpeiPayment(tenantId, email || '', plan, name || '');
      return NextResponse.json(r);
    }

    return NextResponse.json({ error: 'Invalid method' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
