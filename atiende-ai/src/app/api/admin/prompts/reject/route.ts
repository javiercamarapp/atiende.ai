// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/prompts/reject
// Rechaza un prompt de la queue: UPDATE status='rejected'.
// Verifica role=admin.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/is-admin';

const Body = z.object({ id: z.string().uuid() });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await isAdminUser(user))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
    .from('prompt_approval_queue')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('status', 'pending_review');

  if (error) {
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ rejected: true, id: body.id });
}
