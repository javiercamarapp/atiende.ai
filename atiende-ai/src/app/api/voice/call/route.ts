import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { makeOutboundCall } from '@/lib/voice/retell';
import { logWebhook } from '@/lib/webhook-logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, retell_agent_id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const { contactPhone, agentId } = await req.json();

    if (!contactPhone) {
      return NextResponse.json({ error: 'contactPhone is required' }, { status: 400 });
    }

    const resolvedAgentId = agentId || tenant.retell_agent_id;
    if (!resolvedAgentId) {
      return NextResponse.json({ error: 'No voice agent configured' }, { status: 400 });
    }

    const result = await makeOutboundCall(resolvedAgentId, contactPhone, {
      tenant_id: tenant.id,
    });

    await logWebhook({
      tenantId: tenant.id,
      provider: 'retell',
      eventType: 'outbound_call_initiated',
      direction: 'outbound',
      statusCode: 200,
      payload: {
        call_id: result.call_id,
        to_number: contactPhone,
        agent_id: resolvedAgentId,
      },
      durationMs: Date.now() - startTime,
    });

    // Pre-create voice_calls record for the outbound call
    await supabaseAdmin.from('voice_calls').insert({
      tenant_id: tenant.id,
      retell_call_id: result.call_id,
      direction: 'outbound',
      to_number: contactPhone,
      from_number: process.env.TELNYX_PHONE_NUMBER || null,
      started_at: new Date().toISOString(),
      metadata: { agent_id: resolvedAgentId },
    });

    return NextResponse.json({
      success: true,
      callId: result.call_id,
    });
  } catch (err) {
    await logWebhook({
      provider: 'retell',
      eventType: 'outbound_call_error',
      direction: 'outbound',
      statusCode: 500,
      error: err instanceof Error ? err.message : 'Unknown error',
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ error: 'Failed to initiate call' }, { status: 500 });
  }
}
