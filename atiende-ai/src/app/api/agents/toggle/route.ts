import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { z } from 'zod';

const ToggleSchema = z.object({
  agentId: z.string().uuid(),
  action: z.enum(['activate', 'deactivate']),
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
    const parsed = ToggleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }
    const { agentId, action } = parsed.data;

    if (action === 'activate') {
      await supabaseAdmin.from('tenant_agents').upsert(
        { tenant_id: tenantId, agent_id: agentId, is_active: true, activated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,agent_id' }
      );
    } else {
      await supabaseAdmin.from('tenant_agents').update({ is_active: false })
        .eq('tenant_id', tenantId).eq('agent_id', agentId);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
