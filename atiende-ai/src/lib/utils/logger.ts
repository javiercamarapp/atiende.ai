// ═════════════════════════════════════════════════════════════════════════════
// PII-safe logging helpers — sanitización de phone + content para console.*
// Usar en TODOS los logs que toquen datos del paciente para cumplir LFPDPPP.
// ═════════════════════════════════════════════════════════════════════════════

/** Enmascara número de teléfono mostrando solo los últimos 4 dígitos. */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '****';
  const digits = phone.replace(/\D/g, '');
  return digits.length > 4 ? `***${digits.slice(-4)}` : '****';
}

/** Trunca contenido del mensaje para evitar volcar PII completa en logs. */
export function maskContent(content?: string | null): string {
  if (!content) return '[empty]';
  return content.length > 50 ? `${content.slice(0, 50)}...[truncated]` : content;
}

/** Enmascara email mostrando solo dominio (e.g., "***@gmail.com"). */
export function maskEmail(email?: string | null): string {
  if (!email || !email.includes('@')) return '****';
  const parts = email.split('@');
  return `***@${parts[1]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIV-6 — Redacción de PII antes de enviar contexto a LLMs externos
// (OpenRouter / OpenAI / Gemini / Grok). Aplica a teléfonos, emails, RFC,
// CURP, NSS, números de tarjeta. Conservamos contexto semántico
// reemplazando con tokens estables (`[TEL]`, `[EMAIL]`, etc.).
// ─────────────────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<[RegExp, string]> = [
  // Email
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[EMAIL]'],
  // Teléfono mexicano (+52 / 52 / 044 / 045 / 10 dígitos sueltos)
  [/(\+?52\s?1?\s?)?(\d{3}[-\s]?\d{3}[-\s]?\d{4})/g, '[TEL]'],
  // CURP (18 chars alfanumérico)
  [/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, '[CURP]'],
  // RFC (12-13 chars)
  [/\b[A-ZÑ&]{3,4}\d{6}(?:[A-Z\d]{3})?\b/g, '[RFC]'],
  // NSS (11 dígitos)
  [/\b\d{11}\b/g, '[NSS]'],
  // Tarjeta de crédito (13-19 dígitos con o sin guiones/espacios)
  [/\b(?:\d[ -]*?){13,19}\b/g, '[CARD]'],
];

/** Redacta PII (email, tel, CURP, RFC, NSS, tarjeta) preservando estructura. */
export function redactPII(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [pat, token] of PII_PATTERNS) {
    out = out.replace(pat, token);
  }
  return out;
}

/** Redacta PII en cada mensaje del historial antes de pasarlo al LLM. */
export function redactHistoryForLLM<T extends { content: string }>(history: T[]): T[] {
  return history.map((m) => ({ ...m, content: redactPII(m.content) }));
}

/** Construye objeto seguro para logging incluyendo solo IDs y datos no-PII. */
export function safeLog(opts: {
  tenantId?: string;
  conversationId?: string;
  appointmentId?: string;
  phone?: string | null;
  content?: string | null;
  [key: string]: unknown;
}): Record<string, unknown> {
  const { phone, content, ...rest } = opts;
  return {
    ...rest,
    ...(phone !== undefined ? { phone: maskPhone(phone) } : {}),
    ...(content !== undefined ? { content: maskContent(content) } : {}),
  };
}
