// ═════════════════════════════════════════════════════════════════════════════
// PII ENCRYPTION — AES-256-GCM column-level encryption (PRIV-2)
//
// Cifrado application-level para `messages.content`, `media_transcription`
// y `media_description`. Supabase ya cifra el disco con AES-256-XTS, pero
// eso solo protege contra robo físico: cualquiera con SUPABASE_SERVICE_ROLE_KEY
// (o un dev mal-intencionado con SQL Editor) lee historiales clínicos en
// claro. Con esto, el servicio de Postgres ve solo blobs base64.
//
// Formato persistido:    "v1:" + base64(iv) + ":" + base64(ciphertext+authtag)
// Texto sin cifrar:      passthrough — `decryptPII` detecta el prefijo "v1:"
//                        y solo descifra si está presente. Esto permite
//                        rollout gradual sin migración masiva.
//
// Llave: PII_ENCRYPTION_KEY (32 bytes hex en env). Si está ausente, los
// helpers son no-op (passthrough) — útil en CI/dev sin exponer datos.
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'v1:';

let _key: Buffer | null | undefined;

function getKey(): Buffer | null {
  if (_key !== undefined) return _key;
  // Acepta MESSAGES_ENCRYPTION_KEY (nombre canónico) y PII_ENCRYPTION_KEY
  // (alias legacy del primer commit). Ambos = 32 bytes hex.
  const hex = process.env.MESSAGES_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    _key = null;
    return null;
  }
  try {
    _key = Buffer.from(hex, 'hex');
    if (_key.length !== 32) _key = null;
  } catch {
    _key = null;
  }
  return _key;
}

/**
 * Cifra un string con AES-256-GCM. Si la llave no está configurada,
 * devuelve el texto sin cambios (fail-open en dev). En producción debes
 * exigir la key vía env check al boot.
 */
export function encryptPII(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === '') return '';
  const key = getKey();
  if (!key) return plaintext;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([ct, tag]).toString('base64')}`;
  } catch (err) {
    console.warn('[crypto] encryptPII failed:', err instanceof Error ? err.message : err);
    return plaintext;
  }
}

/**
 * Descifra. Si el texto NO tiene el prefijo, asume que es texto plano legacy
 * (rollout gradual) y lo devuelve sin cambios.
 */
export function decryptPII(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext; // legacy plain text
  const key = getKey();
  if (!key) return ciphertext; // sin key no podemos descifrar
  try {
    const [, ivB64, payloadB64] = ciphertext.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');
    const tag = payload.subarray(payload.length - 16);
    const ct = payload.subarray(0, payload.length - 16);
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    console.warn('[crypto] decryptPII failed:', err instanceof Error ? err.message : err);
    return ciphertext;
  }
}

/** Útil para boot: lanza si el sistema corre en producción sin la key. */
export function assertEncryptionConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!getKey()) {
    throw new Error('PII_ENCRYPTION_KEY not configured (or invalid length) in production');
  }
}
