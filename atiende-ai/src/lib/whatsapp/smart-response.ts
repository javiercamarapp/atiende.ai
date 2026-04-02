import { sendTextMessage, sendButtonMessage, sendListMessage, sendLocation } from '@/lib/whatsapp/send';

// ═══════════════════════════════════════════════════════════
// SMART RESPONSE ENGINE
// Intelligent WhatsApp response delivery with:
//  - Auto language detection (Spanish/English)
//  - Smart message splitting at sentence boundaries
//  - Context-aware quick reply button generation
//  - Rich media suggestions (images, locations, documents)
// ═══════════════════════════════════════════════════════════

// ── TYPES ────────────────────────────────────────────────

interface SmartResponseOpts {
  phoneNumberId: string;
  to: string;
  text: string;
  intent: string;
  tenant: {
    name: string;
    phone?: string;
    lat?: number;
    lng?: number;
    address?: string;
    business_type?: string;
  };
  /** Original customer message for language detection */
  customerMessage?: string;
}

type SuggestedMediaType = 'image' | 'location' | 'document' | 'none';

interface RichMediaSuggestion {
  type: SuggestedMediaType;
  reason: string;
  /** For images: suggested image category; for documents: suggested doc type */
  hint?: string;
}

// ── LANGUAGE DETECTION ───────────────────────────────────

const ENGLISH_MARKERS = [
  'hello', 'hi ', 'hey', 'good morning', 'good afternoon', 'good evening',
  'thank you', 'thanks', 'please', 'could you', 'would you', 'do you',
  'i want', 'i need', 'i would', 'how much', 'what time', 'is there',
  'can i', 'can you', 'appointment', 'schedule', 'price', 'available',
  'where are', 'open', 'close', 'delivery', 'order', 'book', 'reserve',
  'information', 'the ', ' is ', ' are ', ' was ', ' were ', ' have ',
];

const SPANISH_MARKERS = [
  'hola', 'buenos', 'buenas', 'gracias', 'por favor', 'quiero', 'necesito',
  'cuanto', 'cuánto', 'donde', 'dónde', 'tiene', 'tienen', 'puedo',
  'puede', 'cita', 'agendar', 'precio', 'disponible', 'horario',
  'pedido', 'servicio', 'reservar', 'menu', 'menú', 'ubicacion',
  'ubicación', 'abierto', 'cerrado', 'entrega', 'domicilio',
  ' el ', ' la ', ' los ', ' las ', ' un ', ' una ', ' es ', ' son ',
];

type DetectedLanguage = 'es' | 'en';

/**
 * Detect whether a customer message is in Spanish or English.
 * Uses keyword matching with a bias toward Spanish (since most
 * atiende.ai users are Mexican businesses).
 *
 * Returns 'es' (Spanish) by default when ambiguous.
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text) return 'es';

  const lower = ` ${text.toLowerCase()} `;
  let enScore = 0;
  let esScore = 0;

  for (const marker of ENGLISH_MARKERS) {
    if (lower.includes(marker)) enScore++;
  }
  for (const marker of SPANISH_MARKERS) {
    if (lower.includes(marker)) esScore++;
  }

  // Bias toward Spanish: needs clear English dominance to switch
  if (enScore > esScore * 1.5 && enScore >= 2) return 'en';
  return 'es';
}

// ── SMART MESSAGE SPLITTING ──────────────────────────────

const WHATSAPP_MAX_LENGTH = 4096; // WhatsApp character limit
const PREFERRED_SPLIT_LENGTH = 1500; // Split long messages for readability

/**
 * Split a long message into multiple chunks at sentence boundaries.
 * Never breaks mid-word or mid-sentence. Each chunk stays under
 * WhatsApp's character limit and is readable on its own.
 */
export function splitMessage(text: string, maxLength = PREFERRED_SPLIT_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining.trim());
      break;
    }

    // Find the best split point: sentence boundary within maxLength
    let splitIdx = -1;

    // Priority 1: Split at paragraph break (\n\n)
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.3) {
      splitIdx = paragraphBreak + 2;
    }

    // Priority 2: Split at line break (\n)
    if (splitIdx === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.3) {
        splitIdx = lineBreak + 1;
      }
    }

    // Priority 3: Split at sentence boundary (. ! ?)
    if (splitIdx === -1) {
      // Search backwards from maxLength for sentence endings
      for (let i = maxLength; i > maxLength * 0.3; i--) {
        const char = remaining[i - 1];
        const nextChar = remaining[i] || '';
        if ((char === '.' || char === '!' || char === '?') && (nextChar === ' ' || nextChar === '\n')) {
          splitIdx = i;
          break;
        }
      }
    }

    // Priority 4: Split at word boundary (space)
    if (splitIdx === -1) {
      const lastSpace = remaining.lastIndexOf(' ', maxLength);
      if (lastSpace > maxLength * 0.3) {
        splitIdx = lastSpace + 1;
      }
    }

    // Fallback: hard split at maxLength (should be very rare)
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter(c => c.length > 0);
}

// ── QUICK REPLY BUTTON GENERATION ────────────────────────

interface QuickReplyContext {
  intent: string;
  businessType: string;
  language: DetectedLanguage;
  /** Whether the conversation has an active appointment flow */
  hasActiveFlow?: boolean;
}

/**
 * Generate context-aware quick reply buttons based on the current
 * intent, business type, and detected language. Returns up to 3
 * buttons (WhatsApp limit).
 */
export function generateQuickReplies(ctx: QuickReplyContext): string[] {
  const { intent, businessType, language } = ctx;

  // Bilingual button labels
  const labels = {
    es: {
      schedule: 'Agendar cita',
      scheduleConsult: 'Agendar consulta',
      prices: 'Ver precios',
      services: 'Ver servicios',
      location: 'Ubicacion',
      human: 'Hablar con alguien',
      hours: 'Horarios',
      menu: 'Ver menu',
      order: 'Hacer pedido',
      orderStatus: 'Estado de pedido',
      reserve: 'Reservar mesa',
      availability: 'Disponibilidad',
      rates: 'Tarifas',
      bookRoom: 'Reservar',
      treatments: 'Tratamientos',
      packages: 'Paquetes',
      moreInfo: 'Mas informacion',
      yesSchedule: 'Si, agendar',
      noThanks: 'No, gracias',
      yesConfirm: 'Si, confirmar',
      cancel: 'Cancelar',
      reschedule: 'Reagendar',
      call: 'Llamar',
      viewAll: 'Ver todos',
      quote: 'Cotizacion',
      delivery: 'Envio a domicilio',
      properties: 'Ver propiedades',
      visit: 'Agendar visita',
      memberships: 'Membresias',
      classes: 'Clases',
      emergency: 'Urgencias',
    },
    en: {
      schedule: 'Book appointment',
      scheduleConsult: 'Book consultation',
      prices: 'See prices',
      services: 'View services',
      location: 'Location',
      human: 'Talk to someone',
      hours: 'Business hours',
      menu: 'View menu',
      order: 'Place order',
      orderStatus: 'Order status',
      reserve: 'Reserve table',
      availability: 'Availability',
      rates: 'Rates',
      bookRoom: 'Book room',
      treatments: 'Treatments',
      packages: 'Packages',
      moreInfo: 'More information',
      yesSchedule: 'Yes, book it',
      noThanks: 'No, thanks',
      yesConfirm: 'Yes, confirm',
      cancel: 'Cancel',
      reschedule: 'Reschedule',
      call: 'Call',
      viewAll: 'View all',
      quote: 'Get a quote',
      delivery: 'Delivery',
      properties: 'View properties',
      visit: 'Schedule visit',
      memberships: 'Memberships',
      classes: 'Classes',
      emergency: 'Emergency',
    },
  };

  const l = labels[language];

  // Intent-specific buttons
  const intentButtons: Record<string, string[]> = {
    APPOINTMENT_NEW: [l.yesSchedule, l.prices, l.human],
    APPOINTMENT_MODIFY: [l.reschedule, l.cancel, l.human],
    APPOINTMENT_CANCEL: [l.yesConfirm, l.reschedule, l.human],
    APPOINTMENT_STATUS: [l.reschedule, l.cancel, l.human],
    PRICE: [l.services, l.schedule, l.moreInfo],
    SERVICES_INFO: [l.prices, l.schedule, l.moreInfo],
    ORDER_NEW: [l.menu, l.order, l.human],
    ORDER_STATUS: [l.orderStatus, l.order, l.human],
    HOURS: [l.location, l.schedule, l.call],
    LOCATION: [l.hours, l.schedule, l.call],
    HUMAN: [l.yesConfirm, l.noThanks],
    EMERGENCY: [l.human, l.call],
    COMPLAINT: [l.human, l.call],
    GREETING: [], // Will be filled by business type below
    FAQ: [l.services, l.schedule, l.human],
    RESERVATION: [l.reserve, l.hours, l.human],
  };

  // If intent has specific buttons, use them
  if (intentButtons[intent] && intentButtons[intent].length > 0) {
    return intentButtons[intent].slice(0, 3);
  }

  // Business-type-specific greeting/fallback buttons
  const typeButtons: Record<string, string[]> = {
    dental: [l.schedule, l.services, l.location],
    medical: [l.scheduleConsult, l.services, l.location],
    restaurant: [l.menu, l.order, l.reserve],
    taqueria: [l.menu, l.order, l.location],
    cafe: [l.menu, l.order, l.hours],
    hotel: [l.availability, l.rates, l.bookRoom],
    real_estate: [l.properties, l.visit, l.quote],
    salon: [l.schedule, l.services, l.location],
    barbershop: [l.schedule, l.services, l.location],
    spa: [l.treatments, l.schedule, l.packages],
    gym: [l.memberships, l.hours, l.classes],
    veterinary: [l.schedule, l.emergency, l.services],
    pharmacy: [l.availability, l.delivery, l.hours],
    psychologist: [l.scheduleConsult, l.services, l.moreInfo],
    school: [l.moreInfo, l.hours, l.human],
    insurance: [l.quote, l.services, l.human],
    mechanic: [l.schedule, l.quote, l.location],
    florist: [l.viewAll, l.order, l.delivery],
    optics: [l.schedule, l.services, l.location],
    nutritionist: [l.scheduleConsult, l.services, l.prices],
  };

  return (typeButtons[businessType] || [l.services, l.schedule, l.location]).slice(0, 3);
}

// ── RICH MEDIA SUGGESTIONS ───────────────────────────────

/**
 * Suggest what type of rich media to attach based on the conversation
 * context. Returns 'none' if plain text is sufficient.
 *
 * Rules:
 *  - LOCATION intent + coordinates available -> location pin
 *  - PRICE/SERVICES intent + business has catalog -> image of catalog
 *  - ORDER_NEW intent for food -> menu image
 *  - APPOINTMENT confirmed -> calendar/document
 *  - General info -> no media needed
 */
export function suggestRichMedia(
  intent: string,
  tenant: SmartResponseOpts['tenant'],
): RichMediaSuggestion {
  // Location intents with coordinates
  if (intent === 'LOCATION' && tenant.lat && tenant.lng) {
    return { type: 'location', reason: 'Cliente pregunto por ubicacion' };
  }

  // Hours intent with location available
  if (intent === 'HOURS' && tenant.lat && tenant.lng) {
    return { type: 'location', reason: 'Complementar horarios con ubicacion del negocio', hint: 'optional' };
  }

  // Menu/catalog for food businesses
  const foodTypes = ['restaurant', 'taqueria', 'cafe'];
  if (foodTypes.includes(tenant.business_type || '')) {
    if (['ORDER_NEW', 'PRICE', 'SERVICES_INFO'].includes(intent)) {
      return { type: 'image', reason: 'Mostrar menu o catalogo visual', hint: 'menu_catalog' };
    }
  }

  // Service catalog for beauty/health
  const catalogTypes = ['salon', 'barbershop', 'spa', 'dental', 'optics'];
  if (catalogTypes.includes(tenant.business_type || '') && ['PRICE', 'SERVICES_INFO'].includes(intent)) {
    return { type: 'image', reason: 'Mostrar catalogo de servicios con precios', hint: 'service_catalog' };
  }

  // Property listings for real estate
  if (tenant.business_type === 'real_estate' && ['SERVICES_INFO', 'PRICE'].includes(intent)) {
    return { type: 'image', reason: 'Mostrar fotos de propiedades disponibles', hint: 'property_photos' };
  }

  // Document for insurance quotes
  if (tenant.business_type === 'insurance' && intent === 'PRICE') {
    return { type: 'document', reason: 'Enviar cotizacion en PDF', hint: 'quote_pdf' };
  }

  // Appointment confirmation could include calendar attachment
  if (['APPOINTMENT_NEW'].includes(intent)) {
    return { type: 'none', reason: 'Cita en proceso, media no necesario aun' };
  }

  return { type: 'none', reason: 'Texto suficiente para esta interaccion' };
}

// ── MAIN SMART RESPONSE DISPATCHER ───────────────────────

/**
 * Send a response via WhatsApp using the best delivery method for the
 * context: buttons, lists, location pins, or split text messages.
 *
 * Automatically detects the customer's language and adapts button labels.
 * Long messages are split at sentence boundaries to avoid mid-word breaks.
 */
export async function sendSmartResponse(opts: SmartResponseOpts) {
  const { phoneNumberId, to, text, intent, tenant, customerMessage } = opts;

  // Detect customer language
  const language = detectLanguage(customerMessage || '');

  // LOCATION -> send map pin
  if (intent === 'LOCATION' && tenant.lat && tenant.lng) {
    await sendLocation(phoneNumberId, to, tenant.lat, tenant.lng, tenant.name, tenant.address || '');
    return;
  }

  // Generate context-aware quick replies
  const quickReplies = generateQuickReplies({
    intent,
    businessType: tenant.business_type || 'other',
    language,
  });

  // APPOINTMENT intents -> interactive buttons
  if (['APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'APPOINTMENT_CANCEL'].includes(intent)) {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // PRICE/SERVICES -> buttons
  if (['PRICE', 'SERVICES_INFO'].includes(intent)) {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // ORDER (restaurants) -> buttons
  if (['ORDER_NEW', 'ORDER_STATUS'].includes(intent)) {
    const isFood = ['restaurant', 'taqueria', 'cafe'].includes(tenant.business_type || '');
    if (isFood) {
      await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
      return;
    }
  }

  // HOURS -> with location button
  if (intent === 'HOURS') {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // GREETING -> welcome with quick options per industry
  if (intent === 'GREETING') {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // HUMAN -> transfer confirmation
  if (intent === 'HUMAN') {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // COMPLAINT -> connect to human
  if (intent === 'COMPLAINT') {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // EMERGENCY -> immediate action buttons
  if (intent === 'EMERGENCY') {
    await sendWithSplitAndButtons(phoneNumberId, to, text, quickReplies);
    return;
  }

  // Default -> smart split plain text (no buttons for general messages)
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await sendTextMessage(phoneNumberId, to, chunk);
  }
}

// ── HELPERS ──────────────────────────────────────────────

/**
 * Send a potentially long message with buttons on the last chunk.
 * If the message is short enough, sends a single button message.
 * If it needs splitting, sends text chunks first and buttons on the last one.
 */
async function sendWithSplitAndButtons(
  phoneNumberId: string,
  to: string,
  text: string,
  buttons: string[],
): Promise<void> {
  if (buttons.length === 0) {
    // No buttons - just send as split text
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await sendTextMessage(phoneNumberId, to, chunk);
    }
    return;
  }

  const chunks = splitMessage(text);

  if (chunks.length === 1) {
    // Single message with buttons
    await sendButtonMessage(phoneNumberId, to, chunks[0], buttons);
    return;
  }

  // Multiple chunks: send text first, buttons on the last chunk
  for (let i = 0; i < chunks.length - 1; i++) {
    await sendTextMessage(phoneNumberId, to, chunks[i]);
  }
  await sendButtonMessage(phoneNumberId, to, chunks[chunks.length - 1], buttons);
}

// ── LEGACY-COMPATIBLE EXPORTS ────────────────────────────

function getQuickOptions(businessType: string): string[] {
  return generateQuickReplies({
    intent: 'GREETING',
    businessType,
    language: 'es',
  });
}

export { getQuickOptions };
