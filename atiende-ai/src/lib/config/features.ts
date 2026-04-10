// Feature flags — controls what's active in the product.
// Only dental and restaurante are live for launch.
// Everything else is standby (code exists but is gated).

export const FEATURES = {
  // ── Verticales activas (22: salud 10 + belleza 6 + gastronomia 6) ──
  ACTIVE_VERTICALS: [
    // CITAS — salud
    'dental', 'medico', 'nutriologa', 'psicologo', 'dermatologo',
    'ginecologo', 'pediatra', 'oftalmologo', 'farmacia', 'veterinaria',
    // CITAS — belleza
    'salon_belleza', 'barberia', 'spa', 'gimnasio', 'nail_salon', 'estetica',
    // PEDIDOS — gastronomia
    'restaurante', 'taqueria', 'cafeteria', 'panaderia', 'bar_cantina', 'food_truck',
  ] as const,

  // ── Módulos activos ──
  APPOINTMENTS_MODULE: true, // Para dental
  ORDERS_MODULE: true, // Para restaurante
  LEADS_MODULE: false, // Standby (inmobiliaria)
  RESERVATIONS_MODULE: false, // Standby (hoteles)
  CATALOG_MODULE: false, // Standby (retail)
  QUOTES_MODULE: false, // Standby (seguros/legal)

  // ── Canales ──
  WHATSAPP_ENABLED: true,
  VOICE_ENABLED: false, // v1.1
  WEB_CHAT_ENABLED: false, // v1.2

  // ── Integraciones ──
  GOOGLE_CALENDAR: true, // Para dental
  CONEKTA_PAYMENTS: false, // v1.1
  FACTURAPI: false, // v1.1
  SOFT_RESTAURANT: false, // v1.1

  // ── Waitlist ──
  WAITLIST_ENABLED: true, // Captura email de verticales inactivas
} as const;

export type ActiveVertical = (typeof FEATURES.ACTIVE_VERTICALS)[number];

export function isActiveVertical(v: string): v is ActiveVertical {
  return (FEATURES.ACTIVE_VERTICALS as readonly string[]).includes(v);
}

export const WAITLIST_RESPONSE = `¡Gracias por tu interés en atiende.ai!

Por el momento estamos trabajando exclusivamente con consultorios dentales y restaurantes para darte la mejor experiencia posible.

¡Pero estamos creciendo pronto! Déjame tu correo electrónico y te aviso en cuanto abramos tu tipo de negocio. Serás de los primeros en tener acceso.`;
