// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/faq-gaps/promote  { tenant_id, question, answer }
// Inserta un FAQ sugerido como knowledge chunk del tenant. Admin-only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ADMIN_EMAILS = ['javier@atiende.ai', 'admin@atiende.ai'];
const Body = z.object({
  tenant_id: z.string().uuid(),
  question: z.string().min(3).max(500),
  answer: z.string().min(3).max(4000),
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

  const content = `P: ${body.question}\nR: ${body.answer}`;

  const { error } = await supabaseAdmin.from('knowledge_chunks').insert({
    tenant_id: body.tenant_id,
    content,
    category: 'faq',
    source: 'admin_faq_gap_promote',
  });

  if (error) {
    return NextResponse.json({ error: 'insert_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: true });
}
