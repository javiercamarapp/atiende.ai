// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/prompts/approve
// Aprueba un prompt de la queue: UPDATE status + reemplaza tenant_prompts.
// Verifica role=admin en el JWT (app_metadata).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ADMIN_EMAILS = ['javier@atiende.ai', 'admin@atiende.ai'];
const Body = z.object({ id: z.string().uuid() });

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

  // 1. Leer la entrada
  const { data: queueRow, error: readErr } = await supabaseAdmin
    .from('prompt_approval_queue')
    .select('id, tenant_id, agent_name, proposed_prompt, status')
    .eq('id', body.id)
    .single();

  if (readErr || !queueRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (queueRow.status !== 'pending_review') {
    return NextResponse.json({ error: 'already_processed', status: queueRow.status }, { status: 409 });
  }

  // 2. UPDATE tenant_prompts (UPSERT) con el proposed_prompt
  const { error: upsertErr } = await supabaseAdmin
    .from('tenant_prompts')
    .upsert(
      {
        tenant_id: queueRow.tenant_id,
        agent_name: queueRow.agent_name,
        prompt_text: queueRow.proposed_prompt,
        model_used: 'fine-tuning',
        is_active: true,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,agent_name' },
    );

  if (upsertErr) {
    return NextResponse.json({ error: 'upsert_failed', message: upsertErr.message }, { status: 500 });
  }

  // 3. UPDATE queue status
  const { error: statusErr } = await supabaseAdmin
    .from('prompt_approval_queue')
    .update({
      status: 'deployed',
      reviewed_at: new Date().toISOString(),
      deployed_at: new Date().toISOString(),
    })
    .eq('id', body.id);

  if (statusErr) {
    return NextResponse.json({ error: 'status_update_failed', message: statusErr.message }, { status: 500 });
  }

  return NextResponse.json({ approved: true, id: body.id });
}
