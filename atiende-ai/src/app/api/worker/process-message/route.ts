// ═════════════════════════════════════════════════════════════════════════════
// WORKER — procesa mensajes WhatsApp en background (llamado por QStash)
//
// Flow:
//   1. Webhook Meta → /api/webhook/whatsapp (verifica HMAC, idempotency)
//   2. Webhook publica el payload a QStash con publishMessage()
//   3. Webhook responde 200 a Meta inmediato (<200ms)
//   4. QStash llama a este endpoint (verifica firma Upstash-Signature)
//   5. Este worker corre processIncomingMessage con presupuesto de 5min
//   6. Si falla, QStash reintenta hasta 3 veces con backoff exponencial
//
// Seguridad: DEBE verificar firma QStash antes de procesar. El header
// Upstash-Signature lo firma QStash con la signing key. Sin verificación,
// cualquiera podría invocar este endpoint y saltarse el HMAC de Meta.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import { verifyQStashSignature } from '@/lib/queue/qstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5min — presupuesto para LLM + tools + send

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get('upstash-signature');
  const rawBody = await req.text();

  // AUDIT-R8 ALTO: la firma QStash se hace contra la URL exacta que se
  // pasó a publishMessage. Si Vercel cambia el host (preview vs prod), la
  // firma falla. Usamos WORKER_URL_BASE env var como fuente de verdad.
  // Fallback: req.nextUrl.origin para dev local sin env.
  // Mismo chain que webhook/whatsapp/route.ts — tiene que matchear para que
  // la firma QStash valide. Ver AUDIT R12 BUG-002.
  const baseUrl = process.env.WORKER_URL_BASE
    || process.env.NEXT_PUBLIC_APP_URL
    || req.nextUrl.origin;
  const url = `${baseUrl}${req.nextUrl.pathname}`;

  const valid = await verifyQStashSignature(signature, rawBody, url);
  if (!valid) {
    console.error('[worker/process-message] invalid QStash signature');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    // payload es el body completo del webhook de Meta
    // (lo que antes pasábamos a processIncomingMessage vía waitUntil)
    await processIncomingMessage(payload as never);
    return NextResponse.json({ status: 'processed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[worker/process-message] processing failed:', msg);
    // Retornar 500 hace que QStash reintente con backoff. Si tras 3 retries
    // sigue fallando, QStash lo manda al DLQ (dead letter queue).
    return NextResponse.json({ error: 'processing_failed', message: msg }, { status: 500 });
  }
}
