import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ingestKnowledge } from '@/lib/rag/search';
import { createServerSupabase } from '@/lib/supabase/server';

// Generates embeddings for every active service + re-indexes knowledge.
// Scales linearly with service count; 120s gives safe headroom.
export const maxDuration = 120;

export async function POST(_req: NextRequest) {
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

    await supabaseAdmin
      .from('knowledge_chunks')
      .delete()
      .eq('tenant_id', tenantId)
      .in('category', ['servicios', 'precios']);

    const { data: svcs } = await supabaseAdmin
      .from('services')
      .select('name,price,duration_minutes')
      .eq('tenant_id', tenantId);

    if (!svcs?.length) return NextResponse.json({ ok: true });

    const content =
      'SERVICIOS Y PRECIOS:\n' +
      svcs.map((s) => `${s.name} - $${s.price} MXN (${s.duration_minutes} min)`).join('\n');

    await ingestKnowledge(tenantId, content, 'servicios');

    return NextResponse.json({ ok: true, count: svcs.length });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
