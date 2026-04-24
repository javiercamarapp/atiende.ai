/**
 * Unificación del rendering del nombre del paciente/contacto en todo el
 * dashboard. Tres fuentes de basura distintas convergen acá:
 *
 *  1. El nombre viene cifrado (v1:...) porque `encryptPII()` lo persistió
 *     y el caller olvidó `decryptPII` antes de renderlo. Lo detectamos
 *     por el prefijo `v1:` y lo tratamos como "sin nombre" porque el
 *     ciphertext no sirve al dueño.
 *  2. El nombre es null/empty porque WhatsApp no expuso `profile.name`
 *     y nadie lo completó después.
 *  3. El nombre quedó como un teléfono (bug viejo — el LLM lo metía como
 *     `patient_name`). Lo detectamos con un regex phone-shape.
 *
 * En cualquiera de esos casos devolvemos `"Paciente …<últimos 4 dígitos>"`,
 * que es human-readable, no exposa el teléfono completo y no dispara el
 * auto-linkify de iOS (no tiene pinta de teléfono).
 */
const PII_PREFIX = 'v1:';
const PHONE_SHAPED = /^[+\d\s\-()]{7,}$/;

function looksLikeEncryptedBlob(s: string): boolean {
  return s.startsWith(PII_PREFIX);
}

function looksLikePhone(s: string): boolean {
  return PHONE_SHAPED.test(s) && !/[a-záéíóúñ]/i.test(s);
}

export function displayPatientName(
  name: string | null | undefined,
  phone: string | null | undefined,
  fallbackLabel = 'Paciente',
): string {
  const trimmed = name?.trim() || '';
  const isUsable = trimmed
    && !looksLikeEncryptedBlob(trimmed)
    && !looksLikePhone(trimmed);
  if (isUsable) return trimmed;

  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length >= 4) return `${fallbackLabel} …${digits.slice(-4)}`;
  return fallbackLabel;
}

/**
 * Para avatares con iniciales. Misma lógica que displayPatientName: si
 * el nombre es basura caemos a los últimos 2 dígitos del teléfono.
 */
export function patientInitials(
  name: string | null | undefined,
  phone: string | null | undefined,
): string {
  const trimmed = name?.trim() || '';
  const isUsable = trimmed
    && !looksLikeEncryptedBlob(trimmed)
    && !looksLikePhone(trimmed);
  if (isUsable) {
    const parts = trimmed.split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
  const digits = (phone || '').replace(/\D/g, '');
  return digits.slice(-2) || '?';
}
