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
  { key: 'hours_whatsapp', type: 'text', required: false,
    label: '¿Cuál es el horario de atención telefónica o por WhatsApp?',
    placeholder: 'Lunes a viernes 8:00 a 20:00' },
  { key: 'hours_urgency', type: 'text', required: false,
    label: '¿Tienen horario de urgencias o consultas de último momento?',
    placeholder: 'Sí, lunes a viernes hasta las 21:00' },
  { key: 'hours_holidays_open', type: 'text', required: false,
    label: '¿Atienden en días puente o períodos vacacionales?',
    placeholder: 'Solo días puente con cita previa' },
  { key: 'doctors_same_schedule', type: 'textarea', required: false,
    label: '¿Todos los doctores atienden los mismos días y horarios?',
    placeholder: 'No, Dr. López: L-M-V, Dra. García: M-J-S' },
  { key: 'consultation_duration', type: 'text', required: false,
    label: '¿Cuánto dura una consulta normalmente?',
    placeholder: '30 a 45 minutos' },
  { key: 'booking_advance', type: 'text', required: false,
    label: '¿Con cuánto tiempo de anticipación se pueden agendar citas?',
    placeholder: 'Hasta 30 días antes' },
  { key: 'same_day_cutoff', type: 'text', required: false,
    label: '¿Cuál es el último horario para agendar una cita el mismo día?',
    placeholder: 'Hasta las 16:00 del mismo día' },
  { key: 'reminder_advance', type: 'text', required: false,
    label: '¿Con cuánto tiempo de anticipación se recuerda la cita al paciente?',
    placeholder: '24 horas antes por WhatsApp' },
  { key: 'booking_after_hours', type: 'text', required: false,
    label: '¿Se puede agendar fuera de horario de atención?',
    placeholder: 'Sí, el bot agenda 24/7 para el siguiente día hábil' },
  { key: 'cancel_deadline', type: 'text', required: false,
    label: '¿Hasta qué hora puedo cancelar o reprogramar mi cita?',
    placeholder: '2 horas antes de la cita' },
  { key: 'arrival_time', type: 'text', required: false,
    label: '¿Cuánto tiempo antes debo llegar a mi cita?',
    placeholder: '15 minutos antes' },
  { key: 'virtual_hours', type: 'text', required: false,
    label: '¿Tienen consultas virtuales/en línea y en qué horario?',
    placeholder: 'Sí, lunes a viernes 10:00 a 14:00' },
  { key: 'virtual_vs_presential', type: 'text', required: false,
    label: '¿El horario de consulta presencial es diferente al de teleconsulta?',
    placeholder: 'Presencial 9-18, teleconsulta 8-20' },
];

export const SHARED_SERVICES_QUESTIONS: Question[] = [
  { key: 'svc_description', type: 'textarea', required: true,
    label: '¿Qué servicios ofreces y qué incluye cada uno?',
    placeholder: 'Limpieza dental ($800, 45 min, incluye revisión y pulido)...',
    help: 'Describe cada servicio: qué incluye, duración y qué problema resuelve' },
  { key: 'svc_packages', type: 'textarea', required: false,
    label: '¿Tienes paquetes o combos de servicios?',
    placeholder: 'Paquete dental completo: limpieza + radiografía + blanqueamiento $2,500' },
  { key: 'svc_tiers', type: 'textarea', required: false,
    label: '¿Tienes diferentes planes o niveles de servicio?',
    placeholder: 'Básico: limpieza, Estándar: limpieza + fluorización, Premium: todo incluido' },
  { key: 'svc_payment_methods', type: 'text', required: false,
    label: '¿Qué formas de pago aceptas?',
    placeholder: 'Efectivo, tarjeta, transferencia, OXXO' },
  { key: 'svc_discounts', type: 'textarea', required: false,
    label: '¿Ofreces descuentos?',
    placeholder: '10% a clientes frecuentes, 2x1 en limpieza los martes',
    help: 'Descuentos por volumen, clientes frecuentes, temporadas, códigos' },
  { key: 'svc_deposit', type: 'text', required: false,
    label: '¿Se requiere anticipo o depósito para reservar?',
    placeholder: '50% de anticipo para tratamientos mayores a $3,000' },
  { key: 'svc_currency', type: 'text', required: false,
    label: '¿En qué moneda manejas tus precios?',
    placeholder: 'Pesos mexicanos (MXN)' },
  { key: 'svc_duration', type: 'textarea', required: false,
    label: '¿Cuánto dura cada servicio?',
    placeholder: 'Consulta: 30 min, Limpieza: 45 min, Ortodoncia: 1 hora' },
  { key: 'svc_coverage', type: 'text', required: false,
    label: '¿Atiendes a domicilio? ¿En qué zonas?',
    placeholder: 'Solo en consultorio, o "A domicilio en zona metropolitana"' },
  { key: 'svc_requirements', type: 'textarea', required: false,
    label: '¿Qué necesita el cliente antes de su cita?',
    placeholder: 'Traer radiografías previas, ayuno de 8 horas, identificación' },
  { key: 'svc_process', type: 'textarea', required: false,
    label: '¿Cómo funciona el proceso de atención paso a paso?',
    placeholder: '1. Agenda por WhatsApp 2. Confirma un día antes 3. Llega 15 min antes 4. Consulta 5. Seguimiento',
    help: 'Desde que el cliente contacta hasta que recibe el servicio' },
];

export const SHARED_TEAM_QUESTIONS: Question[] = [
  { key: 'team_members', type: 'textarea', required: true,
    label: '¿Quiénes forman tu equipo? (nombre, título y especialidad)',
    placeholder: 'Dr. Juan López — Odontólogo general\nDra. María García — Ortodoncista',
    help: 'Nombre completo, título (Dr., Lic., etc.) y área de expertise' },
  { key: 'team_experience', type: 'textarea', required: false,
    label: '¿Cuántos años de experiencia tiene cada profesional?',
    placeholder: 'Dr. López: 15 años, Dra. García: 8 años' },
  { key: 'team_education', type: 'textarea', required: false,
    label: '¿Qué formación académica o certificaciones tienen?',
    placeholder: 'Dr. López: UNAM, posgrado en implantología. Dra. García: UAM, certificada por el Consejo Mexicano de Ortodoncia' },
  { key: 'team_languages', type: 'text', required: false,
    label: '¿Qué idiomas habla tu equipo?',
    placeholder: 'Español, inglés (Dr. López), francés (Dra. García)' },
  { key: 'team_schedule', type: 'textarea', required: false,
    label: '¿Qué días y horarios atiende cada profesional?',
    placeholder: 'Dr. López: L-M-V 9-18, Dra. García: M-J 10-16, S 9-14' },
  { key: 'team_choose_professional', type: 'text', required: false,
    label: '¿El cliente puede elegir con qué profesional ser atendido?',
    placeholder: 'Sí, al agendar puede seleccionar su doctor preferido' },
  { key: 'team_wait_time', type: 'text', required: false,
    label: '¿Cuánto es el tiempo de espera promedio para un profesional específico?',
    placeholder: '1 a 3 días para cita con especialista' },
  { key: 'team_same_professional', type: 'text', required: false,
    label: '¿Puede pedir que lo atienda siempre el mismo profesional?',
    placeholder: 'Sí, se puede fijar un doctor titular en el expediente' },
  { key: 'team_unavailable', type: 'text', required: false,
    label: '¿Qué pasa si su doctor/estilista no está disponible?',
    placeholder: 'Se ofrece cita con otro profesional o se reagenda' },
  { key: 'team_on_call', type: 'text', required: false,
    label: '¿Tienen médicos de guardia o atención de emergencia?',
    placeholder: 'Sí, emergencias dentales L-V hasta las 21:00' },
  { key: 'team_certified', type: 'text', required: false,
    label: '¿El personal está certificado o colegiado?',
    placeholder: 'Todos certificados por el Consejo Mexicano de su especialidad' },
  { key: 'team_patients_count', type: 'text', required: false,
    label: '¿Cuántos pacientes/clientes han atendido?',
    placeholder: 'Más de 5,000 pacientes en 10 años' },
  { key: 'team_awards', type: 'textarea', required: false,
    label: '¿Tiene el equipo logros o reconocimientos?',
    placeholder: 'Premio al mejor consultorio dental de Mérida 2024' },
  { key: 'team_continuing_education', type: 'text', required: false,
    label: '¿Siguen formándose? ¿Asisten a congresos o cursos?',
    placeholder: 'Sí, asisten al congreso ADM anualmente y cursos de actualización cada 6 meses' },
];

export const SHARED_LOCATION_QUESTIONS: Question[] = [
  { key: 'loc_address', type: 'textarea', required: true,
    label: '¿Cuál es tu dirección completa?',
    placeholder: 'Calle 50 #200, Col. Centro, Mérida, Yucatán, CP 97000' },
  { key: 'loc_references', type: 'text', required: false,
    label: '¿Hay referencias visuales para encontrarte?',
    placeholder: 'Frente al parque de Santa Ana, edificio azul de 2 pisos' },
  { key: 'loc_maps_link', type: 'text', required: false,
    label: '¿Cuál es tu link de Google Maps?',
    placeholder: 'https://maps.google.com/...',
    help: 'El bot lo compartirá cuando pregunten cómo llegar' },
  { key: 'loc_directions', type: 'textarea', required: false,
    label: '¿Cómo llegar desde puntos clave de la ciudad?',
    placeholder: 'Desde el centro: por la calle 60 hacia el norte, 5 minutos. Desde el aeropuerto: 20 min por periférico' },
  { key: 'loc_parking_details', type: 'textarea', required: false,
    label: '¿Tienen estacionamiento? ¿Es gratuito o de pago?',
    placeholder: 'Sí, 10 cajones gratis. Estacionamiento público a 50m cuesta $20/hr' },
  { key: 'loc_valet', type: 'text', required: false,
    label: '¿Tienen valet parking?',
    placeholder: 'No / Sí, cortesía para pacientes' },
  { key: 'loc_bike_moto', type: 'text', required: false,
    label: '¿Hay estacionamiento para motos o bicicletas?',
    placeholder: 'Sí, bicicletero en la entrada' },
  { key: 'loc_public_transit', type: 'textarea', required: false,
    label: '¿Qué transporte público pasa cerca?',
    placeholder: 'Ruta 45 y 60, parada a 2 cuadras. Uber disponible en la zona' },
  { key: 'loc_accessibility', type: 'text', required: false,
    label: '¿Tienen acceso para personas con discapacidad?',
    placeholder: 'Sí, rampa de acceso y elevador al 2do piso' },
  { key: 'loc_branches', type: 'textarea', required: false,
    label: '¿Tienen otras sucursales? ¿Dónde?',
    placeholder: 'Sucursal norte: Av. Prolongación Montejo 300. Sucursal sur: Plaza Altabrisa local 15' },
  { key: 'loc_branch_services', type: 'textarea', required: false,
    label: '¿Cada sucursal ofrece los mismos servicios?',
    placeholder: 'Sucursal norte: todos los servicios. Sucursal sur: solo consulta general' },
  { key: 'loc_zone_context', type: 'text', required: false,
    label: '¿En qué zona, plaza o centro comercial están?',
    placeholder: 'Plaza Altabrisa, planta baja, local 15' },
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
  schedule: ['hours_weekday', 'hours_saturday', 'hours_sunday', 'holidays', 'hours_whatsapp', 'hours_urgency', 'hours_holidays_open', 'doctors_same_schedule', 'consultation_duration', 'booking_advance', 'same_day_cutoff', 'reminder_advance', 'booking_after_hours', 'cancel_deadline', 'arrival_time', 'virtual_hours', 'virtual_vs_presential', 'schedule', 'scheduling', 'scheduling_preferences', 'checkin_out', 'same_day'],

  services: ['svc_description', 'svc_packages', 'svc_tiers', 'svc_payment_methods', 'svc_discounts', 'svc_deposit', 'svc_currency', 'svc_duration', 'svc_coverage', 'svc_requirements', 'svc_process', 'services_prices', 'menu', 'services', 'services_offered', 'treatments', 'procedures', 'products', 'classes', 'packages', 'exams', 'vaccines', 'lens_types', 'frame_brands', 'insurance_types', 'credit_types', 'property_types', 'therapy_types', 'diagnostic_equipment', 'price_range', 'consultation', 'consultation_duration', 'consultation_vs_procedure'],

  team: ['team_members', 'team_experience', 'team_education', 'team_languages', 'team_schedule', 'team_choose_professional', 'team_wait_time', 'team_same_professional', 'team_unavailable', 'team_on_call', 'team_certified', 'team_patients_count', 'team_awards', 'team_continuing_education', 'doctors', 'stylists', 'barbers', 'trainers'],

  location: ['loc_address', 'loc_references', 'loc_maps_link', 'loc_directions', 'loc_parking_details', 'loc_valet', 'loc_bike_moto', 'loc_public_transit', 'loc_accessibility', 'loc_branches', 'loc_branch_services', 'loc_zone_context', 'parking', 'zones', 'airport_transfer', 'rooms', 'facilities', 'wifi'],

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
  if (zoneId === 'services') {
    const verticalSvcKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.services.includes(k));
    return [...SHARED_SERVICES_QUESTIONS.map((q) => q.key), ...verticalSvcKeys];
  }
  if (zoneId === 'team') {
    const verticalTeamKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.team.includes(k));
    return [...SHARED_TEAM_QUESTIONS.map((q) => q.key), ...verticalTeamKeys];
  }
  if (zoneId === 'location') {
    const verticalLocKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.location.includes(k));
    return [...SHARED_LOCATION_QUESTIONS.map((q) => q.key), ...verticalLocKeys];
  }
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
  if (zoneId === 'services') {
    const verticalSvc = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.services.includes(q.key)
    );
    return [...SHARED_SERVICES_QUESTIONS, ...verticalSvc];
  }
  if (zoneId === 'team') {
    const verticalTeam = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.team.includes(q.key)
    );
    return [...SHARED_TEAM_QUESTIONS, ...verticalTeam];
  }
  if (zoneId === 'location') {
    const verticalLoc = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.location.includes(q.key)
    );
    return [...SHARED_LOCATION_QUESTIONS, ...verticalLoc];
  }
  if (zoneId === 'brand') {
    const verticalBrand = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.brand.includes(q.key)
    );
    return [...SHARED_BRAND_QUESTIONS, ...verticalBrand];
  }
  const allowed = new Set(ZONE_QUESTION_KEYS[zoneId]);
  return verticalQuestions.filter((q) => allowed.has(q.key));
}
