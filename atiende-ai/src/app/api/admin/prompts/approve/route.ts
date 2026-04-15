// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/prompts/approve  { id }
// Aprueba y DESPLIEGA un prompt de la approval queue.
// Delega en applyApprovedPrompt() del pipeline de fine-tuning.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { applyApprovedPrompt } from '@/lib/agents/internal/prompt-fine-tuning';
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

  const result = await applyApprovedPrompt(body.id);

  if (!result.applied) {
    const status = result.error === 'not_found' ? 404 : result.error === 'already_rejected' ? 409 : 500;
    return NextResponse.json({ error: result.error || 'apply_failed' }, { status });
  }

  return NextResponse.json({
    approved: true,
    deployed: true,
    id: body.id,
    tenant_id: result.tenant_id,
    agent_name: result.agent_name,
  });
}
