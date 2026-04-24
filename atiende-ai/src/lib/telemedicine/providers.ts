// ═════════════════════════════════════════════════════════════════════════════
// Telemedicine provider abstraction (Phase 2.C)
//
// Generamos un identifier único por cita (room name) y lo convertimos a URL
// según el provider configurado en tenants.telemedicine_provider.
//
// Jitsi Meet (default): meet.jit.si es free, no requiere account. Room
// names son globales — usamos prefix para colisión-safety.
// Daily.co: requiere DAILY_API_KEY (no implementado acá, skeleton).
// custom_url: el tenant tiene su propia URL base (ej. Teams, Zoom), el
// sistema solo genera el room name y concatena.
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

export type TelemedProvider = 'jitsi' | 'daily' | 'custom_url';

/**
 * Genera un room name único para una cita. 12 chars de entropía + prefix
 * atiende-. No usa el UUID completo del appointment por legibilidad en la
 * URL y para evitar leak del ID en caso de share público.
 */
export function generateRoomName(appointmentId: string): string {
  const entropy = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  // Primeros 8 chars del appointment-id para trazabilidad + entropy
  const shortId = appointmentId.replace(/-/g, '').slice(0, 8);
  return `atiende-${shortId}-${entropy}`;
}

export function buildTelemedUrl(
  provider: TelemedProvider,
  room: string,
  customUrlBase?: string | null,
): string {
  switch (provider) {
    case 'jitsi':
      return `https://meet.jit.si/${room}`;
    case 'daily':
      // Daily.co pattern: https://{domain}.daily.co/{room}
      // Requiere DAILY_API_KEY + crear room via API. En producción hacer
      // create-room call y guardar la URL directa. Fallback a Jitsi por ahora.
      return `https://meet.jit.si/${room}`;
    case 'custom_url':
      if (!customUrlBase) return `https://meet.jit.si/${room}`;
      const sep = customUrlBase.includes('?') ? '&' : '?';
      return `${customUrlBase}${sep}room=${encodeURIComponent(room)}`;
  }
}
