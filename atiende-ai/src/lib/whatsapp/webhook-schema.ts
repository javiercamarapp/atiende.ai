// ═════════════════════════════════════════════════════════════════════════════
// WhatsApp webhook payload schema (AUDIT P2 item 6)
//
// Meta envía un JSON estructurado predecible pero con campos opcionales. Antes
// lo accedíamos con optional chaining crudo (`body?.entry?.[0]?.changes?.[0]`).
// Ese approach deja pasar payloads malformados que pueden crashear 3 capas
// dentro del processor — lejos del punto de entrada.
//
// Este schema valida la forma mínima que el pipeline necesita. NO intenta ser
// exhaustivo (Meta cambia la API; bloquearla con validación estricta rompería
// el webhook en cada cambio de provider). En su lugar:
//
//   - `.passthrough()` en todos los objetos — preservamos campos desconocidos.
//   - `.optional()` en casi todo — status updates no tienen `messages`, etc.
//   - Validación ESTRICTA solo en campos que el pipeline lee y que si son
//     garbage pueden causar daño (id del mensaje, timestamp para replay check,
//     phone_number_id para tenant lookup).
//
// Si la validación falla, el webhook debe responder 200 `{status:'invalid_payload'}`
// — nunca 500, porque Meta reintentaría y duplicaría.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

/**
 * Mensaje individual de WhatsApp. id + timestamp son requeridos (los usa
 * idempotency + replay protection).
 */
const WhatsAppMessageSchema = z
  .object({
    id: z.string().min(1).max(256),
    from: z.string().min(1).max(32),
    type: z.string().min(1).max(32),
    // Meta envía timestamp como string de unix seconds ("1709312400").
    timestamp: z.string().regex(/^\d{8,12}$/),
  })
  .passthrough();

const WhatsAppStatusSchema = z
  .object({
    id: z.string().min(1).max(256),
    status: z.string().min(1).max(32),
    timestamp: z.string().regex(/^\d{8,12}$/),
  })
  .passthrough();

const WhatsAppMetadataSchema = z
  .object({
    phone_number_id: z.string().regex(/^\d{10,20}$/),
    display_phone_number: z.string().optional(),
  })
  .passthrough();

const WhatsAppValueSchema = z
  .object({
    metadata: WhatsAppMetadataSchema,
    messages: z.array(WhatsAppMessageSchema).optional(),
    statuses: z.array(WhatsAppStatusSchema).optional(),
    contacts: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

const WhatsAppChangeSchema = z
  .object({
    value: WhatsAppValueSchema,
    field: z.string().optional(),
  })
  .passthrough();

const WhatsAppEntrySchema = z
  .object({
    changes: z.array(WhatsAppChangeSchema).min(1),
  })
  .passthrough();

export const WhatsAppWebhookSchema = z
  .object({
    object: z.string().optional(),
    entry: z.array(WhatsAppEntrySchema).min(1),
  })
  .passthrough();

export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookSchema>;

/**
 * Replay protection: si el timestamp más reciente del payload es más viejo
 * que `maxAgeSeconds`, rechazamos como replay.
 *
 * Meta entrega webhooks en segundos — rarísimo ver >5s de latencia. Un
 * payload de hace 5+ min casi siempre indica replay (attacker con secret
 * re-enviando captura anterior) o un bug de reintento del lado de Meta ya
 * irrelevante.
 *
 * Usamos el MÁXIMO (no mínimo) porque en un batch de múltiples mensajes el
 * timestamp más reciente es el más indicativo de "cuándo envió Meta".
 *
 * Retorna:
 *   - `{ ok: true }` si el batch es reciente o no hay timestamps.
 *   - `{ ok: false, ageSeconds }` si excedió.
 */
export function checkWebhookReplay(
  payload: WhatsAppWebhookPayload,
  maxAgeSeconds = 300,
): { ok: true } | { ok: false; ageSeconds: number } {
  const timestamps: number[] = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value.messages || []) {
        const t = parseInt(m.timestamp, 10);
        if (Number.isFinite(t)) timestamps.push(t);
      }
    }
  }
  if (timestamps.length === 0) return { ok: true };
  const nowSec = Math.floor(Date.now() / 1000);
  const mostRecent = Math.max(...timestamps);
  const age = nowSec - mostRecent;
  if (age > maxAgeSeconds) return { ok: false, ageSeconds: age };
  return { ok: true };
}

/**
 * Extrae todos los `messages[].id` (wa_message_id) del payload. Usado para
 * idempotency multi-mensaje (AUDIT P1 item 1): un batch puede traer varios
 * mensajes; antes solo verificábamos `messages[0].id`.
 */
export function extractMessageIds(payload: WhatsAppWebhookPayload): string[] {
  const ids: string[] = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value.messages || []) {
        if (m.id) ids.push(m.id);
      }
    }
  }
  return ids;
}
