// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/fraud/update  { id, status }
// Cambia estado de una fraud_alert. Admin-only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ADMIN_EMAILS = ['javier@atiende.ai', 'admin@atiende.ai'];
const Body = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'investigating', 'resolved', 'false_positive']),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin' || ADMIN_EMAILS.includes(user.email || '');
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from('fraud_alerts')
    .update({ status: body.status })
    .eq('id', body.id);

  if (error) {
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: true, id: body.id, status: body.status });
}
