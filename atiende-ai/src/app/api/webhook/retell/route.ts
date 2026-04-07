import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook } from '@/lib/webhook-logger';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

// Retell signs the raw request body with HMAC-SHA256.
function verifyRetellSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  // Length mismatch must be handled BEFORE timingSafeEqual (which throws).
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  const webhookSecret = process.env.RETELL_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('RETELL_WEBHOOK_SECRET missing — refusing to process webhook');
    logWebhook({ provider: 'retell', eventType: 'config_error', statusCode: 500, error: 'RETELL_WEBHOOK_SECRET not configured', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'RETELL_WEBHOOK_SECRET not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-retell-signature');

  if (!verifyRetellSignature(rawBody, signature, webhookSecret)) {
    logWebhook({ provider: 'retell', eventType: 'auth_failed', statusCode: 401, error: 'Invalid signature', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
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
  const callId = body.call_id;

  // Defense-in-depth: look up tenant_id for this call BEFORE any updates,
  // so we can scope every subsequent .update() by tenant_id.
  const { data: call } = await supabaseAdmin
    .from('voice_calls')
    .select('tenant_id, from_number, to_number, direction')
    .eq('retell_call_id', callId)
    .single();

  if (!call) {
    logger.warn('Retell call_ended: no voice_calls row found for retell_call_id', { callId });
    return;
  }

  const tenantId = call.tenant_id;

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
    .eq('retell_call_id', callId)
    .eq('tenant_id', tenantId);

  {
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
      .eq('retell_call_id', callId)
      .eq('tenant_id', tenantId);
  }
}

async function handleCallAnalyzed(body: Record<string, unknown>) {
  const callId = body.call_id;
  const analysis = (body.call_analysis as Record<string, unknown>) || {};
  const customAnalysis = analysis.custom_analysis as Record<string, unknown> | undefined;

  // Defense-in-depth: scope update by tenant_id from a prior lookup of the call.
  const { data: call } = await supabaseAdmin
    .from('voice_calls')
    .select('tenant_id')
    .eq('retell_call_id', callId)
    .single();

  if (!call) {
    logger.warn('Retell call_analyzed: no voice_calls row found for retell_call_id', { callId });
    return;
  }

  await supabaseAdmin
    .from('voice_calls')
    .update({
      summary: (analysis.call_summary as string) || (analysis.summary as string),
      sentiment: analysis.user_sentiment,
      outcome: (analysis.call_outcome as string) || customAnalysis?.outcome,
      recording_url: body.recording_url,
    })
    .eq('retell_call_id', callId)
    .eq('tenant_id', call.tenant_id);
}
