// ═════════════════════════════════════════════════════════════════════════════
// PATIENT PORTAL — tokens HMAC-firmados para acceso self-service
//
// El paciente recibe un link por WhatsApp (ej. "https://atiende.ai/portal/<token>")
// que le permite ver su historial sin loguearse. El token:
//   - Está firmado con una clave derivada (HKDF) de ENCRYPTION_KEY_V1. Si
//     alguien lo modifica, la verify falla.
//   - Incluye tenant_id + contact_id + expiry. Si el timestamp pasó, la verify
//     falla aunque el HMAC match.
//   - NO lleva PII. El contact_id es UUID opaco.
//
// Formato: "v1.<base64url_payload>.<base64url_hmac_12bytes>" donde payload es
// JSON {t: tenantId, c: contactId, e: expEpochSec}.
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 días — paciente puede tardar

interface PortalPayload {
  t: string;   // tenant_id
  c: string;   // contact_id
  e: number;   // exp epoch seconds
}

let _portalKey: Buffer | null | undefined;

function getPortalKey(): Buffer {
  if (_portalKey !== undefined && _portalKey !== null) return _portalKey;
  // Audit fix: SOLO ENCRYPTION_KEY_V1. Antes había fallback a
  // SUPABASE_SERVICE_ROLE_KEY (peligroso si rotás la service-role key porque
  // invalida tokens existentes) y a string vacío (HMAC predecible).
  const base = process.env.ENCRYPTION_KEY_V1;
  if (!base || base.length < 32) {
    throw new Error(
      '[portal-token] ENCRYPTION_KEY_V1 requerida (≥32 chars) para firmar tokens del portal. ' +
      'Sin esta var el portal no funciona — configurá en Vercel env.',
    );
  }
  _portalKey = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(base), 'atiende-portal', 'token-v1', 32),
  );
  return _portalKey;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signPortalToken(
  tenantId: string,
  contactId: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const payload: PortalPayload = {
    t: tenantId,
    c: contactId,
    e: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = crypto.createHmac('sha256', getPortalKey()).update(body).digest().subarray(0, 12);
  return `v1.${body}.${b64url(mac)}`;
}

export function verifyPortalToken(
  token: string,
): { ok: true; tenantId: string; contactId: string } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'malformed' };
  const [, body, macStr] = parts;

  let expected: Buffer;
  try {
    expected = crypto.createHmac('sha256', getPortalKey()).update(body).digest().subarray(0, 12);
  } catch {
    return { ok: false, reason: 'keyless' };
  }
  const got = fromB64url(macStr);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let parsed: PortalPayload;
  try {
    parsed = JSON.parse(fromB64url(body).toString('utf8')) as PortalPayload;
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (!parsed.t || !parsed.c || !parsed.e) return { ok: false, reason: 'missing_fields' };
  if (parsed.e * 1000 < Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, tenantId: parsed.t, contactId: parsed.c };
}

export function buildPortalUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://atiende.ai';
  return `${base.replace(/\/+$/, '')}/portal/${token}`;
}
