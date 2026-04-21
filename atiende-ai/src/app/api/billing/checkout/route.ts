import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { createCheckoutSession } from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  plan: z.enum(['basic', 'pro', 'premium']),
});

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await checkApiRateLimit(`${user.id}:billing_checkout`, 10, 60)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Tenant se deriva del user autenticado (no del body) — evita que un user
  // inicie un checkout contra un tenant ajeno.
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, email')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json(
      { error: 'No encontramos tu cuenta. Completa el onboarding primero.' },
      { status: 404 },
    );
  }

  const email = (tenant.email as string) || user.email;
  if (!email) {
    return NextResponse.json({ error: 'Email no disponible' }, { status: 400 });
  }

  try {
    const session = await createCheckoutSession(tenant.id as string, email, parsed.data.plan);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'checkout_failed';
    console.error('[api/billing/checkout]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
