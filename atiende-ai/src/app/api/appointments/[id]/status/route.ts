import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 15;
export const runtime = 'nodejs';

const BodySchema = z.object({
  status: z.enum(['confirmed', 'completed', 'no_show', 'scheduled']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:appt_status`, 60, 60)) {
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
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!apt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (apt.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot change status of a cancelled appointment' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({ status: parsed.data.status })
      .eq('id', apt.id);

    if (error) {
      logger.error('[api/appt/status] DB update failed', new Error(error.message), { appointment_id: id });
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: parsed.data.status });
  } catch (err) {
    logger.error(
      '[api/appointments/[id]/status] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
