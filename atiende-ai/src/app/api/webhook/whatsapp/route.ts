import { NextRequest, NextResponse } from 'next/server';
import { processIncomingMessage } from '@/lib/whatsapp/processor';
import crypto from 'crypto';

// GET: Verificacion del webhook (Meta lo llama UNA VEZ al configurar)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verificado por Meta');
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// POST: Recibir mensajes — el endpoint mas importante del sistema
export async function POST(req: NextRequest) {
  try {
    // Verify Meta/WhatsApp signature using WA_APP_SECRET
    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();

    if (process.env.WA_APP_SECRET) {
      if (!signature) {
        console.error('Missing x-hub-signature-256 header');
        return new NextResponse('Unauthorized', { status: 401 });
      }

      const expectedSig = 'sha256=' + crypto
        .createHmac('sha256', process.env.WA_APP_SECRET)
        .update(rawBody)
        .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig)
      )) {
        console.error('Invalid webhook signature');
        return new NextResponse('Unauthorized', { status: 401 });
      }
    }

    const body = JSON.parse(rawBody);

    // RESPONDER 200 INMEDIATAMENTE — no bloquear
    // Procesar el mensaje en background
    processIncomingMessage(body).catch(err => {
      console.error('Error procesando mensaje WA:', err);
    });

    return NextResponse.json({ status: 'received' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
