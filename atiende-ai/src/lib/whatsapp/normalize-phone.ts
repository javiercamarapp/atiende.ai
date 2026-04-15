// ═════════════════════════════════════════════════════════════════════════════
// Normaliza números de teléfono al formato WhatsApp Cloud API.
//
// Regla clave: WhatsApp retorna el número EN EL FORMATO que envía el cliente
// (sin "+", solo dígitos). Nuestra normalización debe preservar el código de
// país original — NO podemos forzar +52 si el paciente escribe desde EE. UU.
// (+1), Colombia (+57) o cualquier otro país, porque corromperíamos el
// identificador con el que Meta nos manda respuestas.
//
// Comportamiento:
//   - México: "9991234567" (10 dígitos sueltos)        → "5219991234567"
//   - México: "+52 999 123 4567" / "529991234567"      → "5219991234567"
//   - México: "+5219991234567" / "5219991234567"       → "5219991234567"
//   - EE.UU.: "+1 415 555 1234" / "14155551234"        → "14155551234"
//   - Colombia: "+57 300 123 4567" / "573001234567"    → "573001234567"
//   - Otro código país reconocido: preserva tal cual (solo dígitos).
//
// Determinación "es MX":
//   - 10 dígitos sin código de país → asumimos MX (país default del negocio)
//   - Empieza con "52" + 10 dígitos → MX (agregar el "1" de WhatsApp)
//   - Empieza con "521" + 10 dígitos → MX ya normalizado
//   - Cualquier otro patrón (11+ dígitos que NO empieza con 52) → NO tocar
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Prefijos de códigos de país más comunes para clientes de atiende.ai.
 * No es exhaustivo — el objetivo es detectar cuándo SÍ es MX vs cuándo
 * claramente NO lo es para preservar el número internacional tal cual.
 */
const NON_MX_COUNTRY_PREFIXES = [
  '1',    // US/CA
  '54',   // AR
  '55',   // BR
  '56',   // CL
  '57',   // CO
  '58',   // VE
  '51',   // PE
  '53',   // CU
  '34',   // ES
  '44',   // UK
  '49',   // DE
  '33',   // FR
  '39',   // IT
  '81',   // JP
  '86',   // CN
  '91',   // IN
  '7',    // RU
  '61',   // AU
  '64',   // NZ
  '82',   // KR
  '502',  // GT
  '503',  // SV
  '504',  // HN
  '505',  // NI
  '506',  // CR
  '507',  // PA
  '591',  // BO
  '593',  // EC
  '595',  // PY
  '598',  // UY
];

export function normalizePhoneMx(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';

  // Ya viene en formato WhatsApp MX (521 + 10 dígitos)
  if (digits.startsWith('521') && digits.length === 13) return digits;

  // Código país MX (52 + 10 dígitos) — falta el "1" de WhatsApp
  if (digits.startsWith('52') && digits.length === 12) return '521' + digits.slice(2);

  // 10 dígitos locales sin código de país → asumimos MX (default business)
  if (digits.length === 10) return '521' + digits;

  // Números internacionales: preservar tal cual si matchea prefijo conocido.
  // Largo razonable de números internacionales: 10–15 dígitos (E.164 max).
  if (digits.length >= 10 && digits.length <= 15) {
    for (const prefix of NON_MX_COUNTRY_PREFIXES) {
      if (digits.startsWith(prefix)) {
        return digits;
      }
    }
  }

  // Formato no reconocible — devolver solo los dígitos (fallback seguro).
  return digits;
}
