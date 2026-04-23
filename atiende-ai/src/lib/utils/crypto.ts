// ═════════════════════════════════════════════════════════════════════════════
// PII ENCRYPTION — AES-256-GCM column-level encryption (PRIV-2)
//
// Cifrado application-level para `messages.content`, `media_transcription`,
// `media_description`, y (desde R21) `contacts.phone`, `contacts.name`,
// `conversations.customer_phone`, `appointments.customer_phone`.
//
// Supabase ya cifra el disco con AES-256-XTS, pero eso solo protege contra
// robo físico: cualquiera con SUPABASE_SERVICE_ROLE_KEY lee datos en claro.
//
// Formato persistido:    "v1:" + base64(iv) + ":" + base64(ciphertext+authtag)
// Texto sin cifrar:      passthrough — `decryptPII` detecta el prefijo "v1:"
//                        y solo descifra si está presente. Rollout gradual.
//
// Para campos usados como lookup key (phone), se almacena un blind index
// (HMAC-SHA256 truncado a 32 chars hex) en una columna `_hash` que permite
// equality lookups sin exponer el valor plano. Ver `hashForBlindIndex()`.
//
// Llave: MESSAGES_ENCRYPTION_KEY (32 bytes hex en env). Si ausente, helpers
// son no-op (passthrough) — útil en CI/dev sin exponer datos.
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

// La primera vez que se invoque encrypt/decrypt, si estamos en producción Y
// no hay key válida, LANZAMOS en vez de fail-open a texto plano. Sin esto,
// un olvido de ENV en devops mandaba historiales clínicos en claro a
// Supabase sin alerta alguna (violación LFPDPPP/HIPAA).
let _assertedOnce = false;
function assertKeyOrFailClosed(): Buffer | null {
  const key = getKey();
  if (key) return key;
  if (process.env.NODE_ENV === 'production' && !_assertedOnce) {
    _assertedOnce = true; // evita spam de throws en el mismo proceso
    throw new Error(
      'MESSAGES_ENCRYPTION_KEY (or PII_ENCRYPTION_KEY) is missing or invalid in production. ' +
      'Refusing to store medical content in plaintext. Configure a 32-byte hex key ' +
      'and redeploy. See supabase/migrations/messages_media.sql for schema.',
    );
  }
  return null;
}

/**
 * Cifra un string con AES-256-GCM. NUNCA lanza excepciones — la decisión
 * de fail-closed en producción se toma en BOOT (ver assertEncryptionConfigured),
 * no por-llamada. Así evitamos matar abruptamente el waitUntil de Vercel si
 * algo raro pasa a mitad del pipeline.
 *
 * Antes encryptPII propagaba throw si faltaba la key en prod, lo que mataba
 * la función de Vercel a mitad del procesamiento de un mensaje. Ahora la
 * defensa contra key-missing es solo al boot (fail-fast deploy), y el
 * runtime siempre es resiliente.
 */
export function encryptPII(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === '') return '';
  const key = getKey();
  if (!key) {
    // En producción esto NO debería ocurrir porque assertEncryptionConfigured
    // se llamó al boot; si pasa, loggeamos para alertar pero no rompemos.
    if (process.env.NODE_ENV === 'production') {
      console.error('[crypto] CRITICAL: encryption key missing in production runtime — storing plaintext fallback. Redeploy with MESSAGES_ENCRYPTION_KEY set.');
    }
    return plaintext;
  }
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

// ═════════════════════════════════════════════════════════════════════════════
// KEY ROTATION V2
//
// Envelope: write always with the newest key; read tries v2 first, falls back
// to v1. The prefix stays "v1:" (encryption format version, not key version)
// — both keys use the same AES-256-GCM envelope. The re-encrypt cron reads
// old rows, decrypts (auto-falling-back), re-encrypts with the new key, and
// writes back. Once all rows are re-encrypted, remove the old key from env.
// ═════════════════════════════════════════════════════════════════════════════

let _keyV2: Buffer | null | undefined;

function getKeyV2(): Buffer | null {
  if (_keyV2 !== undefined) return _keyV2;
  const hex = process.env.MESSAGES_ENCRYPTION_KEY_V2;
  if (!hex || hex.length !== 64) {
    _keyV2 = null;
    return null;
  }
  try {
    _keyV2 = Buffer.from(hex, 'hex');
    if (_keyV2.length !== 32) _keyV2 = null;
  } catch {
    _keyV2 = null;
  }
  return _keyV2;
}

function getWriteKey(): Buffer | null {
  return getKeyV2() || getKey();
}

function decryptWithKey(ciphertext: string, key: Buffer): string | null {
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
  } catch {
    return null;
  }
}

/**
 * Decrypt with key rotation: try v2 key first, then v1. If both fail,
 * return ciphertext unchanged (legacy plaintext or corrupt data).
 */
export function decryptPIIWithRotation(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;

  const v2 = getKeyV2();
  if (v2) {
    const result = decryptWithKey(ciphertext, v2);
    if (result !== null) return result;
  }

  const v1 = getKey();
  if (v1) {
    const result = decryptWithKey(ciphertext, v1);
    if (result !== null) return result;
  }

  return ciphertext;
}

/**
 * Encrypt with the newest available key (v2 > v1).
 * Used for all new writes so that key rotation makes progress.
 */
export function encryptPIIWithRotation(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === '') return '';
  const key = getWriteKey();
  if (!key) return plaintext;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([ct, tag]).toString('base64')}`;
  } catch {
    return plaintext;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BLIND INDEX — HMAC-SHA256 for searchable encrypted fields
//
// Phone numbers need equality lookups (WHERE phone_hash = X). We can't
// compare encrypted values (random IV → different ciphertext each time).
// Instead we store a truncated HMAC alongside the encrypted value.
//
// Security: HMAC with a dedicated key (derived from the main key via HKDF)
// so compromising the HMAC doesn't leak the encryption key. Truncated to
// 16 bytes (32 hex chars) — sufficient for uniqueness, resists rainbow tables
// because the key is secret.
// ═════════════════════════════════════════════════════════════════════════════

let _hmacKey: Buffer | null | undefined;

function getHmacKey(): Buffer | null {
  if (_hmacKey !== undefined) return _hmacKey;
  const baseKey = getWriteKey();
  if (!baseKey) {
    _hmacKey = null;
    return null;
  }
  _hmacKey = Buffer.from(crypto.hkdfSync('sha256', baseKey, 'atiende-blind-index', 'phone-hash', 32));
  return _hmacKey;
}

export function hashForBlindIndex(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const key = getHmacKey();
  if (!key) return null;
  const normalized = value.replace(/[^\d+]/g, '');
  return crypto.createHmac('sha256', key).update(normalized).digest('hex').slice(0, 32);
}

/**
 * Check if a value needs re-encryption (was encrypted with v1 key but v2 is
 * now available). Used by the re-encrypt cron to identify stale rows.
 */
export function needsReEncryption(ciphertext: string | null | undefined): boolean {
  if (!ciphertext || !ciphertext.startsWith(PREFIX)) return false;
  const v2 = getKeyV2();
  if (!v2) return false;
  const result = decryptWithKey(ciphertext, v2);
  return result === null;
}
