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
