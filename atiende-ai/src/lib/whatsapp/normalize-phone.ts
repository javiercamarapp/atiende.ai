// ═════════════════════════════════════════════════════════════════════════════
// Normaliza números de teléfono mexicanos al formato de WhatsApp Cloud API.
// WhatsApp requiere: 521 + 10 dígitos = 13 dígitos total, sin "+", sin espacios.
// Aceptamos varios formatos de input:
//   "9991234567"            → "5219991234567"  (10 dígitos, agrega prefijo MX)
//   "+52 999 123 4567"      → "5219991234567"  (limpia + espacios + convierte 52→521)
//   "52 999-123-4567"       → "5219991234567"
//   "+529991234567"         → "5219991234567"
//   "5219991234567"         → "5219991234567"  (ya normalizado)
//   "+5219991234567"        → "5219991234567"
// Teléfonos no-MX se devuelven solo con los dígitos (sin reformatear).
// ═════════════════════════════════════════════════════════════════════════════

export function normalizePhoneMx(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';

  // Ya viene en formato WhatsApp MX (521 + 10 dígitos)
  if (digits.startsWith('521') && digits.length === 13) return digits;

  // Código país MX (52 + 10 dígitos) — falta el "1" de WhatsApp
  if (digits.startsWith('52') && digits.length === 12) return '521' + digits.slice(2);

  // 10 dígitos locales sin código de país → agregar 521
  if (digits.length === 10) return '521' + digits;

  // Otro formato (internacional, incompleto, etc.) — devolver sin modificar
  return digits;
}
