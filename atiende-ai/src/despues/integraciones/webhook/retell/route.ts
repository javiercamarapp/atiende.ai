import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook, enforceWebhookSize, enforceWebhookSizePostRead, WEBHOOK_MAX_BYTES } from '@/lib/webhook-logger';
import { trackVoiceCall } from '@/lib/billing/voice-tracker';
import { sendTextMessageSafe } from '@/lib/whatsapp/send';
import { VOICE_ALERT_THRESHOLD_PERCENT, VOICE_OVERAGE_PRICE_MXN } from '@/lib/config';

// Redis para cooldown de alertas — fail-open si no está configurado.
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Cooldown anti-spam de alertas al dueño.
 * Sin esto, un consultorio con 5 llamadas overage en 1h recibe 5 mensajes.
 * TTL = 6h por tipo (warning vs overage). El owner recibe máximo 1 alerta
 * de cada tipo cada 6h por mes.
 */
async function shouldSendAlert(tenantId: string, type: 'warning' | 'overage'): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // fail-open en CI/dev
  const key = `voice_alert:${type}:${tenantId}`;
  try {
    const result = await redis.set(key, '1', { nx: true, ex: 6 * 3600 });
    return result === 'OK';
  } catch {
    return true; // fail-open si Redis falla
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Guard de tamaño ANTES de bufferear.
  const sizeCheck = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'retell', startTime);
  if (!sizeCheck.ok) return sizeCheck.response;

  // Read raw body as Buffer BEFORE auth — needed for HMAC verification.
  // Same pattern as the WhatsApp webhook: arrayBuffer() preserves exact bytes.
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const postRead = enforceWebhookSizePostRead(rawBuffer.byteLength, WEBHOOK_MAX_BYTES, 'retell', startTime);
  if (!postRead.ok) return postRead.response;

  const apiKey = process.env.RETELL_API_KEY;
  const signature = req.headers.get('x-retell-signature');

  if (signature && apiKey) {
    // Preferred: HMAC-SHA256 verification (timing-safe)
    const expectedSig = crypto
      .createHmac('sha256', apiKey)
      .update(rawBuffer)
      .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    let valid = false;
    if (sigBuf.length === expectedBuf.length) {
      try {
        valid = crypto.timingSafeEqual(sigBuf, expectedBuf);
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      logWebhook({ provider: 'retell', eventType: 'auth_failed', statusCode: 401, error: 'Invalid HMAC signature', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }
  } else {
    // Fallback: Bearer token or legacy x-retell-api-key header (log warning)
    const authHeader = req.headers.get('authorization');
    const legacyApiKey = req.headers.get('x-retell-api-key');
    const isAuthorized =
      (authHeader && apiKey && authHeader === `Bearer ${apiKey}`) ||
      (legacyApiKey && apiKey && legacyApiKey === apiKey);

    if (!isAuthorized) {
      logWebhook({ provider: 'retell', eventType: 'auth_failed', statusCode: 401, error: 'Invalid API key', durationMs: Date.now() - startTime });
      return new NextResponse('Unauthorized', { status: 401 });
    }
    console.warn('[retell-webhook] using legacy API key auth — migrate to HMAC signature');
  }

  try {
    // Parse body from the buffer we already read (don't call req.json() or req.text() again)
    const body = JSON.parse(rawBuffer.toString('utf-8'));
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
  const durationSeconds = body.duration_ms
    ? Math.round((body.duration_ms as number) / 1000)
    : (body.duration_seconds as number) || 0;
  const updateData: Record<string, unknown> = {
    duration_seconds: durationSeconds,
    ended_at: new Date().toISOString(),
    cost_usd: body.cost,
  };

  // ─── Billing: trackear minutos de voz + alertar al dueño ──────────────────
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const tenantId = metadata?.tenant_id as string | undefined;
  const callId = body.call_id as string | undefined;
  if (tenantId && callId && durationSeconds > 0) {
    const usage = await trackVoiceCall(tenantId, callId, durationSeconds).catch((err) => {
      console.error('[retell-webhook] trackVoiceCall failed:', err);
      return null;
    });

    // Alerta al dueño si cruza umbral (default 80%) o ya está en overage.
    if (usage && (usage.percentUsed >= VOICE_ALERT_THRESHOLD_PERCENT || usage.isOverage)) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('wa_phone_number_id, phone, name')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenant?.wa_phone_number_id && tenant?.phone) {
        const alertType: 'warning' | 'overage' = usage.isOverage ? 'overage' : 'warning';
        const allowed = await shouldSendAlert(tenantId, alertType);
        if (allowed) {
          try {
            const text = usage.isOverage
              ? (() => {
                  const extraMin = Math.ceil(usage.overage);
                  const extraCost = extraMin * VOICE_OVERAGE_PRICE_MXN;
                  return (
                    `📊 *useatiende.ai — Minutos adicionales activos*\n` +
                    `Ha superado los ${usage.included} minutos incluidos.\n` +
                    `Minutos extra este mes: ${extraMin}\n` +
                    `Costo adicional: $${extraCost} MXN\n` +
                    `Se cargará automáticamente al final del mes.`
                  );
                })()
              : (
                  `⚠️ *useatiende.ai — Aviso de uso de voz*\n` +
                  `Ha usado el ${usage.percentUsed}% de sus minutos.\n` +
                  `Le quedan ${usage.remaining} minutos incluidos.\n` +
                  `Minutos extra: $${VOICE_OVERAGE_PRICE_MXN} MXN c/u.`
                );

            // Usar sendTextMessageSafe para respetar la ventana 24h de
            // Meta. Si está cerrada, no rompe (solo no envía).
            const r = await sendTextMessageSafe(
              tenant.wa_phone_number_id as string,
              tenant.phone as string,
              text,
              { tenantId },
            );
            if (!r.ok && r.windowExpired) {
              console.warn('[retell-webhook] alert skipped — 24h window closed for owner');
            }
          } catch (err) {
            console.warn('[retell-webhook] owner alert failed:', err instanceof Error ? err.message : err);
          }
        }
      }
    }
  }

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
