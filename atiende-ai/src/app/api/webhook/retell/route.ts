import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Support both Bearer token (official Retell webhook signature) and legacy x-retell-api-key header
  const authHeader = req.headers.get('authorization');
  const legacyApiKey = req.headers.get('x-retell-api-key');
  const isAuthorized =
    (authHeader && authHeader === `Bearer ${process.env.RETELL_API_KEY}`) ||
    (legacyApiKey && legacyApiKey === process.env.RETELL_API_KEY);

  if (!isAuthorized) {
    logWebhook({ provider: 'retell', eventType: 'auth_failed', statusCode: 401, error: 'Invalid API key', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const event = body.event;
    const tenantId = body.metadata?.tenant_id;

    logWebhook({
      tenantId,
      provider: 'retell',
      eventType: event,
      statusCode: 200,
      payload: { call_id: body.call_id, event },
      durationMs: Date.now() - startTime,
    });

    switch (event) {
      case 'call_started':
        await handleCallStarted(body);
        break;
      case 'call_ended':
        await handleCallEnded(body);
        break;
      case 'call_analyzed':
        await handleCallAnalyzed(body);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logWebhook({ provider: 'retell', eventType: 'error', statusCode: 400, error: err instanceof Error ? err.message : 'Bad request', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}

async function handleCallStarted(body: Record<string, unknown>) {
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const tenantId = metadata?.tenant_id as string | undefined;
  if (!tenantId) return;

  await supabaseAdmin.from('voice_calls').insert({
    tenant_id: tenantId,
    retell_call_id: body.call_id,
    direction: (body.direction as string) || 'inbound',
    from_number: body.from_number,
    to_number: body.to_number,
    started_at: new Date().toISOString(),
    metadata: metadata || {},
  });
}

async function handleCallEnded(body: Record<string, unknown>) {
  const updateData: Record<string, unknown> = {
    duration_seconds: body.duration_ms
      ? Math.round((body.duration_ms as number) / 1000)
      : body.duration_seconds,
    ended_at: new Date().toISOString(),
    cost_usd: body.cost,
  };

  // Transcript completo
  if (body.transcript) {
    updateData.transcript = body.transcript;
  }
  if (body.transcript_object) {
    updateData.transcript_segments = body.transcript_object;
  }

  await supabaseAdmin
    .from('voice_calls')
    .update(updateData)
    .eq('retell_call_id', body.call_id);

  // Crear/actualizar conversacion y contacto
  const { data: call } = await supabaseAdmin
    .from('voice_calls')
    .select('tenant_id, from_number, to_number, direction')
    .eq('retell_call_id', body.call_id)
    .single();

  if (call) {
    const customerPhone = call.direction === 'inbound'
      ? call.from_number : call.to_number;

    // Upsert contacto
    await supabaseAdmin.from('contacts').upsert({
      tenant_id: call.tenant_id,
      phone: customerPhone,
    }, { onConflict: 'tenant_id,phone' });

    // Crear conversacion de voz
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .upsert({
        tenant_id: call.tenant_id,
        customer_phone: customerPhone,
        channel: 'voice',
        last_message_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,customer_phone,channel' })
      .select('id')
      .single();

    // Guardar transcript como mensaje
    if (body.transcript && conv) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        tenant_id: call.tenant_id,
        direction: 'inbound',
        sender_type: 'customer',
        content: body.transcript,
        message_type: 'voice_transcript',
      });
    }

    // Vincular call con conversacion
    await supabaseAdmin.from('voice_calls')
      .update({ conversation_id: conv?.id })
      .eq('retell_call_id', body.call_id);
  }
}

async function handleCallAnalyzed(body: Record<string, unknown>) {
  const analysis = (body.call_analysis as Record<string, unknown>) || {};
  const customAnalysis = analysis.custom_analysis as Record<string, unknown> | undefined;

  await supabaseAdmin
    .from('voice_calls')
    .update({
      summary: (analysis.call_summary as string) || (analysis.summary as string),
      sentiment: analysis.user_sentiment,
      outcome: (analysis.call_outcome as string) || customAnalysis?.outcome,
      recording_url: body.recording_url,
    })
    .eq('retell_call_id', body.call_id);
}
