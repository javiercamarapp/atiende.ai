// Zone map — single source of truth for the 10-zone conversational layout
// on /knowledge. Maps every onboarding question_key to a zone, defines the
// synthetic cross-vertical questions (schedule + brand) asked regardless of
// vertical, and exposes helpers to compute completion per zone / globally.

import type { Question } from '@/lib/onboarding/questions';

export type ZoneId =
  | 'schedule'
  | 'services'
  | 'team'
  | 'location'
  | 'payments'
  | 'policies'
  | 'special'
  | 'experience'
  | 'brand'
  | 'logistics';

export interface Zone {
  id: ZoneId;
  title: string;
  description: string;
  icon: string;      // lucide-react icon name
  accent: string;    // tailwind color token, e.g. 'blue', 'violet'
  category: string;  // knowledge_chunks.category used when ingesting
  alwaysVisible: boolean;
}

export const ZONES: Zone[] = [
  { id: 'schedule',   title: 'Horario de atención',  description: 'Cuándo está abierto tu negocio',     icon: 'Clock',       accent: 'blue',    category: 'horario',   alwaysVisible: true  },
  { id: 'services',   title: 'Servicios y precios',  description: 'Lo que ofreces y cuánto cuesta',     icon: 'Sparkles',    accent: 'violet',  category: 'servicios', alwaysVisible: false },
  { id: 'team',       title: 'Tu equipo',            description: 'Staff, doctores, estilistas',        icon: 'Users',       accent: 'emerald', category: 'staff',     alwaysVisible: false },
  { id: 'location',   title: 'Ubicación',            description: 'Dirección, estacionamiento, zonas',  icon: 'MapPin',      accent: 'orange',  category: 'ubicacion', alwaysVisible: false },
  { id: 'payments',   title: 'Formas de pago',       description: 'Métodos, financiamiento, facturas',  icon: 'CreditCard',  accent: 'amber',   category: 'pagos',     alwaysVisible: false },
  { id: 'policies',   title: 'Políticas',            description: 'Cancelación, garantía, privacidad',  icon: 'ShieldCheck', accent: 'indigo',  category: 'politicas', alwaysVisible: false },
  { id: 'special',    title: 'Casos especiales',     description: 'Seguros, alergenos, emergencias',    icon: 'Star',        accent: 'rose',    category: 'especial',  alwaysVisible: false },
  { id: 'experience', title: 'Primera visita',       description: 'Qué esperar la primera vez',         icon: 'Compass',     accent: 'teal',    category: 'faq',       alwaysVisible: false },
  { id: 'brand',      title: 'Tu marca',             description: 'Tono, idiomas, diferenciadores',     icon: 'Palette',     accent: 'fuchsia', category: 'marca',     alwaysVisible: true  },
  { id: 'logistics',  title: 'Entregas y reservas',  description: 'Delivery, reservaciones, envíos',    icon: 'Truck',       accent: 'cyan',    category: 'logistica', alwaysVisible: false },
];

// Synthetic questions asked in every vertical via the new quiz UI.
// Not present in QUESTIONS map — schedule/brand zones source them here.
export const SHARED_SCHEDULE_QUESTIONS: Question[] = [
  { key: 'hours_weekday', type: 'text', required: true,
    label: '¿Cuál es tu horario de lunes a viernes?',
    placeholder: '9:00 a 18:00' },
  { key: 'hours_saturday', type: 'text', required: false,
    label: '¿Y los sábados?',
    placeholder: '9:00 a 14:00, o "cerrado"' },
  { key: 'hours_sunday', type: 'text', required: false,
    label: '¿Abres domingos?',
    placeholder: 'Cerrado, o 10:00 a 14:00' },
  { key: 'holidays', type: 'textarea', required: false,
    label: 'Días festivos que cierras',
    placeholder: '1 enero, jueves y viernes santo, 16 sep, 25 dic',
    help: 'El bot le avisará al cliente si pregunta por un día feriado' },
];

export const SHARED_BRAND_QUESTIONS: Question[] = [
  { key: 'tone', type: 'text', required: true,
    label: '¿Qué tono debe usar tu bot?',
    placeholder: 'Formal, cercano, amigable',
    help: 'Cambia cómo te habla a tus clientes' },
  { key: 'tagline', type: 'text', required: false,
    label: 'Frase que te describe (tagline)',
    placeholder: 'Salud bucal con calidez yucateca' },
  { key: 'languages', type: 'text', required: false,
    label: 'Idiomas que hablan',
    placeholder: 'Español, inglés básico' },
  { key: 'differentiator', type: 'textarea', required: false,
    label: '¿Qué te hace diferente de la competencia?',
    placeholder: '25 años de experiencia, equipo 100% certificado, atención en domingo' },
];

// Maps vertical question keys to zones. Keys not listed fall back to 'brand'
// (safe catch-all). Kept explicit rather than inferred to avoid surprises as
// new keys are added in onboarding/questions.ts.
export const ZONE_QUESTION_KEYS: Record<ZoneId, string[]> = {
  schedule: ['hours_weekday', 'hours_saturday', 'hours_sunday', 'holidays', 'schedule', 'scheduling', 'scheduling_preferences', 'checkin_out', 'same_day'],

  services: ['services_prices', 'menu', 'services', 'services_offered', 'treatments', 'procedures', 'products', 'classes', 'packages', 'exams', 'vaccines', 'lens_types', 'frame_brands', 'insurance_types', 'credit_types', 'property_types', 'therapy_types', 'diagnostic_equipment', 'price_range', 'consultation', 'consultation_duration', 'consultation_vs_procedure'],

  team: ['doctors', 'stylists', 'barbers', 'trainers'],

  location: ['parking', 'zones', 'airport_transfer', 'rooms', 'facilities', 'wifi'],

  payments: ['payment_methods', 'financing', 'tuition', 'cfdi_support', 'gift_cards', 'loyalty', 'memberships', 'free_trial'],

  policies: ['cancellation', 'confidentiality', 'warranty', 'turnaround', 'min_age', 'age_range'],

  special: ['insurances', 'insurance', 'allergens', 'vegetarian', 'kids_menu', 'pets', 'emergency', 'emergency_protocol', 'online', 'online_sessions', 'online_service', 'telemedicine', 'couples', 'happy_hour', 'events', 'hospitalization', 'ultrasound', 'prenatal_care', 'bridal', 'scholarships', 'extracurriculars'],

  experience: ['first_visit', 'first_session', 'visit_process', 'post_care', 'enrollment_process', 'arrangements', 'appointment_type', 'grooming', 'prescription_handling', 'otc_products', 'pharmacy', 'mortgage_help', 'claims_support', 'quote_process', 'parent_communication'],

  brand: ['tone', 'tagline', 'languages', 'differentiator', 'approach', 'specialties', 'brands', 'food_menu', 'beverages', 'salsas', 'amenities', 'equipment', 'tools', 'software', 'breakfast', 'meal_plans', 'levels', 'species', 'carriers', 'extra_info'],

  logistics: ['delivery', 'delivery_platforms', 'reservations', 'pickup_delivery', 'catering', 'custom_orders'],
};

// Inverse lookup built once for O(1) zone-for-key resolution.
const KEY_TO_ZONE: Record<string, ZoneId> = (() => {
  const map: Record<string, ZoneId> = {};
  for (const zone of Object.keys(ZONE_QUESTION_KEYS) as ZoneId[]) {
    for (const key of ZONE_QUESTION_KEYS[zone]) map[key] = zone;
  }
  return map;
})();

export function zoneForQuestionKey(key: string): ZoneId {
  return KEY_TO_ZONE[key] ?? 'brand';
}

export interface ZoneCompletion {
  zoneId: ZoneId;
  total: number;
  answered: number;
  percent: number; // 0..100 integer
}

function questionKeysForZone(zoneId: ZoneId, verticalQuestions: Question[]): string[] {
  if (zoneId === 'schedule') return SHARED_SCHEDULE_QUESTIONS.map((q) => q.key);
  if (zoneId === 'brand') {
    // Brand zone always shows the shared brand questions plus any
    // vertical-specific keys mapped to 'brand'.
    const verticalBrandKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.brand.includes(k));
    return [...SHARED_BRAND_QUESTIONS.map((q) => q.key), ...verticalBrandKeys];
  }
  const allowed = new Set(ZONE_QUESTION_KEYS[zoneId]);
  return verticalQuestions.map((q) => q.key).filter((k) => allowed.has(k));
}

export function computeZoneCompletion(
  zoneId: ZoneId,
  verticalQuestions: Question[],
  answeredKeys: Set<string>
): ZoneCompletion {
  const keys = questionKeysForZone(zoneId, verticalQuestions);
  const total = keys.length;
  const answered = keys.filter((k) => answeredKeys.has(k)).length;
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return { zoneId, total, answered, percent };
}

export function computeOverallCompletion(
  verticalQuestions: Question[],
  answeredKeys: Set<string>
): { total: number; answered: number; percent: number } {
  let total = 0;
  let answered = 0;
  for (const zone of ZONES) {
    const comp = computeZoneCompletion(zone.id, verticalQuestions, answeredKeys);
    total += comp.total;
    answered += comp.answered;
  }
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return { total, answered, percent };
}

// Filters the zone list down to what the owner should see. schedule/brand
// are always visible; the rest hide when they have zero applicable questions
// for this vertical. Keeps the UI uncluttered for simpler verticals.
export function getVisibleZones(verticalQuestions: Question[]): Zone[] {
  return ZONES.filter((z) => {
    if (z.alwaysVisible) return true;
    const keys = questionKeysForZone(z.id, verticalQuestions);
    return keys.length > 0;
  });
}

export function getQuestionsForZone(
  zoneId: ZoneId,
  verticalQuestions: Question[]
): Question[] {
  if (zoneId === 'schedule') return SHARED_SCHEDULE_QUESTIONS;
  if (zoneId === 'brand') {
    const verticalBrand = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.brand.includes(q.key)
    );
    return [...SHARED_BRAND_QUESTIONS, ...verticalBrand];
  }
  const allowed = new Set(ZONE_QUESTION_KEYS[zoneId]);
  return verticalQuestions.filter((q) => allowed.has(q.key));
}
