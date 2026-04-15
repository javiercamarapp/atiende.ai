// ═════════════════════════════════════════════════════════════════════════════
// QSTASH QUEUE — procesamiento asíncrono decoupleado del webhook
//
// Problema que resuelve:
//   - Meta exige HTTP 200 al webhook en <5s, idealmente <1s.
//   - `waitUntil` (Vercel) mantiene la función viva hasta 5min, pero si el
//     procesamiento excede ese límite, la función se mata sin retry.
//   - Si la pipeline falla a mitad (error LLM transient, DB down), el
//     mensaje del paciente se pierde para siempre.
//
// Solución: el webhook publica el mensaje a QStash y responde 200 inmediato.
// QStash se encarga de:
//   - Reintentar con backoff si el worker falla (hasta 3 retries por default)
//   - Firma HMAC para verificar que el call al worker viene de QStash
//   - Separar ejecución del webhook de la ejecución del procesamiento
//
// Degradación: si QSTASH_TOKEN no está configurado (dev/local), el caller
// debe fallback a `waitUntil(processIncomingMessage)` — publishMessage()
// retorna `{ ok: false, reason: 'not_configured' }` para que el caller sepa.
// ═════════════════════════════════════════════════════════════════════════════

import { Client, Receiver } from '@upstash/qstash';

let _client: Client | null = null;
let _receiver: Receiver | null = null;

function getClient(): Client | null {
  if (_client) return _client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  _client = new Client({ token });
  return _client;
}

function getReceiver(): Receiver | null {
  if (_receiver) return _receiver;
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return null;
  _receiver = new Receiver({
    currentSigningKey: current,
    nextSigningKey: next,
  });
  return _receiver;
}

/** Publica un mensaje al worker asíncrono. */
export async function publishMessage(
  workerUrl: string,
  payload: unknown,
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const c = getClient();
  if (!c) return { ok: false, reason: 'not_configured' };
  try {
    const result = await c.publishJSON({
      url: workerUrl,
      body: payload,
      retries: 3,
      // Delay 0 = ejecutar inmediato (no es un cron programado)
      notBefore: undefined,
    });
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Verifica la firma HMAC que QStash envía en el header Upstash-Signature.
 * DEBE llamarse en el worker endpoint antes de procesar cualquier payload.
 */
export async function verifyQStashSignature(
  signature: string | null,
  body: string,
  url: string,
): Promise<boolean> {
  const r = getReceiver();
  if (!r) return false;
  if (!signature) return false;
  try {
    return await r.verify({
      signature,
      body,
      url,
    });
  } catch {
    return false;
  }
}

export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN
    && !!process.env.QSTASH_CURRENT_SIGNING_KEY
    && !!process.env.QSTASH_NEXT_SIGNING_KEY;
}
