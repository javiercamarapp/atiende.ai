import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 15;

const BodySchema = z.object({
  prompt: z.string().min(1).max(20000),
  welcomeMessage: z.string().min(1).max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:tenant_prompt`, 10, 60)) {
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

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const updates: Record<string, string> = {
      chat_system_prompt: parsed.data.prompt,
    };
    if (parsed.data.welcomeMessage) {
      updates.welcome_message = parsed.data.welcomeMessage;
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update(updates)
      .eq('id', tenant.id);

    if (error) {
      logger.error('[tenant/prompt] update failed', new Error(error.message), { tenant_id: tenant.id });
      return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[tenant/prompt] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
