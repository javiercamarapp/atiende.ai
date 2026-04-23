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
  | 'logistics'
  | 'docs-menu'
  | 'docs-general';

export interface Zone {
  id: ZoneId;
  title: string;
  description: string;
  icon: string;
  accent: string;
  category: string;
  alwaysVisible: boolean;
}

export const ZONES: Zone[] = [
  { id: 'schedule',     title: 'Horario',              description: 'Dias, horarios y citas',              icon: 'Clock',       accent: 'blue',    category: 'horario',     alwaysVisible: true  },
  { id: 'services',     title: 'Servicios y precios',  description: 'Lo que ofreces y cuanto cuesta',      icon: 'Sparkles',    accent: 'violet',  category: 'servicios',   alwaysVisible: true  },
  { id: 'team',         title: 'Tu equipo',            description: 'Profesionales y especialidades',      icon: 'Users',       accent: 'emerald', category: 'staff',       alwaysVisible: true  },
  { id: 'location',     title: 'Ubicacion',            description: 'Direccion, como llegar, sucursales',  icon: 'MapPin',      accent: 'orange',  category: 'ubicacion',   alwaysVisible: true  },
  { id: 'payments',     title: 'Pagos y facturas',     description: 'Metodos de pago y facturacion',       icon: 'CreditCard',  accent: 'amber',   category: 'pagos',       alwaysVisible: true  },
  { id: 'policies',     title: 'Politicas',            description: 'Reglas y politicas del negocio',      icon: 'ShieldCheck', accent: 'indigo',  category: 'politicas',   alwaysVisible: true  },
  { id: 'special',      title: 'Casos especiales',     description: 'Seguros, urgencias, condiciones',     icon: 'Star',        accent: 'rose',    category: 'especial',    alwaysVisible: false },
  { id: 'experience',   title: 'Primera visita',       description: 'Que esperar la primera vez',          icon: 'Compass',     accent: 'teal',    category: 'faq',         alwaysVisible: false },
  { id: 'brand',        title: 'Tu marca',             description: 'Identidad, tono y diferenciadores',   icon: 'Palette',     accent: 'fuchsia', category: 'marca',       alwaysVisible: true  },
  { id: 'logistics',    title: 'Entregas y reservas',  description: 'Delivery, reservaciones, envios',     icon: 'Truck',       accent: 'cyan',    category: 'logistica',   alwaysVisible: false },
  { id: 'docs-menu',    title: 'Menu de precios',      description: 'Sube tu lista de precios o catalogo', icon: 'CreditCard',  accent: 'amber',   category: 'precios',     alwaysVisible: true  },
  { id: 'docs-general', title: 'Documentos',           description: 'Manuales, catalogos y archivos',      icon: 'Compass',     accent: 'indigo',  category: 'documentos',  alwaysVisible: true  },
];

// ═══ 50 SHARED QUESTIONS (consolidated from 131) ═════════════════════════════

export const SHARED_SCHEDULE_QUESTIONS: Question[] = [
  { key: 'hours_weekday', type: 'text', required: true,
    label: 'Horario entre semana',
    placeholder: 'Lunes a viernes 9:00 a 18:00' },
  { key: 'hours_weekend', type: 'text', required: false,
    label: 'Horario fin de semana',
    placeholder: 'Sabado 9-14, Domingo cerrado',
    options: ['Cerrado', 'Mismo horario', 'Solo sabado', 'Solo con cita'] },
  { key: 'schedule_booking', type: 'text', required: false,
    label: 'Anticipacion para agendar y duracion de consulta',
    placeholder: 'Agendar hasta 30 dias antes. Consulta dura 30-45 min',
    options: ['Mismo dia', '1 dia antes', '1 semana', '1 mes'] },
  { key: 'schedule_cancel', type: 'text', required: false,
    label: 'Politica de cancelacion y llegada',
    placeholder: 'Cancelar 24h antes. Llegar 15 min antes',
    options: ['2 horas antes', '12 horas antes', '24 horas antes', '48 horas antes'] },
  { key: 'schedule_urgency', type: 'boolean', required: false,
    label: 'Atienden urgencias fuera de horario?' },
  { key: 'schedule_virtual', type: 'boolean', required: false,
    label: 'Tienen consultas virtuales o en linea?' },
];

export const SHARED_SERVICES_QUESTIONS: Question[] = [
  { key: 'svc_list', type: 'textarea', required: true,
    label: 'Lista de servicios con precios',
    placeholder: 'Consulta general $500\nLimpieza dental $800\nBlanqueamiento $2,500',
    help: 'Un servicio por linea con precio. Esta es la info mas importante para el bot' },
  { key: 'svc_packages', type: 'textarea', required: false,
    label: 'Paquetes, combos o promociones',
    placeholder: 'Paquete completo: limpieza + radiografia + blanqueamiento $2,500' },
  { key: 'svc_duration', type: 'textarea', required: false,
    label: 'Duracion de cada servicio',
    placeholder: 'Consulta: 30 min, Limpieza: 45 min, Ortodoncia: 1 hora' },
  { key: 'svc_process', type: 'textarea', required: false,
    label: 'Como funciona el proceso de atencion',
    placeholder: '1. Agenda por WhatsApp 2. Confirma 24h antes 3. Llega 15 min antes 4. Consulta 5. Seguimiento',
    help: 'Paso a paso desde que contacta hasta que recibe el servicio' },
  { key: 'svc_requirements', type: 'textarea', required: false,
    label: 'Que necesita traer el cliente',
    placeholder: 'Identificacion, estudios previos, lista de medicamentos' },
  { key: 'svc_coverage', type: 'text', required: false,
    label: 'Atienden a domicilio?',
    options: ['Solo en consultorio', 'A domicilio', 'Ambos', 'Teleconsulta'] },
];

export const SHARED_TEAM_QUESTIONS: Question[] = [
  { key: 'team_members', type: 'textarea', required: true,
    label: 'Miembros del equipo (nombre, titulo, especialidad)',
    placeholder: 'Dr. Juan Lopez — Odontologo general, 15 años exp\nDra. Maria Garcia — Ortodoncista, cert. CMO',
    help: 'Incluye titulo, especialidad, años de experiencia y certificaciones' },
  { key: 'team_schedule', type: 'textarea', required: false,
    label: 'Horario de cada profesional',
    placeholder: 'Dr. Lopez: L-M-V 9-18\nDra. Garcia: M-J 10-16, S 9-14' },
  { key: 'team_choose', type: 'boolean', required: false,
    label: 'El cliente puede elegir con quien atenderse?' },
  { key: 'team_languages', type: 'multi_select', required: false,
    label: 'Idiomas que habla el equipo',
    options: ['Espanol', 'Ingles', 'Frances', 'Portugues', 'Maya', 'Otro'] },
  { key: 'team_certified', type: 'boolean', required: false,
    label: 'El equipo esta certificado o colegiado?' },
];

export const SHARED_LOCATION_QUESTIONS: Question[] = [
  { key: 'loc_address', type: 'textarea', required: true,
    label: 'Direccion completa y referencias',
    placeholder: 'Calle 50 #200, Col. Centro, Merida, Yuc. CP 97000. Frente al parque de Santa Ana' },
  { key: 'loc_maps', type: 'text', required: false,
    label: 'Link de Google Maps',
    placeholder: 'https://maps.google.com/...',
    help: 'El bot lo comparte cuando pregunten como llegar' },
  { key: 'loc_parking', type: 'text', required: false,
    label: 'Estacionamiento',
    options: ['Gratuito propio', 'De pago propio', 'Publico cercano', 'En la calle', 'Valet parking', 'No hay'] },
  { key: 'loc_transit', type: 'text', required: false,
    label: 'Como llegar en transporte publico',
    placeholder: 'Ruta 45, parada a 2 cuadras. Metro Linea 1 estacion Centro' },
  { key: 'loc_accessibility', type: 'boolean', required: false,
    label: 'Tienen acceso para personas con discapacidad?' },
];

export const SHARED_PAYMENTS_QUESTIONS: Question[] = [
  { key: 'pay_methods', type: 'multi_select', required: true,
    label: 'Formas de pago que aceptan',
    options: ['Efectivo', 'Tarjeta debito', 'Tarjeta credito', 'Transferencia/SPEI', 'OXXO', 'PayPal', 'Mercado Pago'] },
  { key: 'pay_financing', type: 'text', required: false,
    label: 'Meses sin intereses o financiamiento',
    options: ['No ofrecemos', '3 MSI', '6 MSI', '12 MSI', '3, 6 y 12 MSI'] },
  { key: 'pay_deposit', type: 'text', required: false,
    label: 'Se requiere anticipo? Cuanto?',
    options: ['No', '20%', '30%', '50%', '100%'] },
  { key: 'pay_invoice', type: 'boolean', required: false,
    label: 'Emiten facturas (CFDI)?' },
  { key: 'pay_cash_discount', type: 'boolean', required: false,
    label: 'Tienen descuento por pago en efectivo?' },
];

export const SHARED_POLICIES_QUESTIONS: Question[] = [
  { key: 'pol_cancel', type: 'text', required: false,
    label: 'Politica de cancelacion',
    placeholder: 'Cancelar con 24h de anticipacion sin cargo',
    options: ['Sin penalizacion', 'Se cobra 50%', 'Se pierde anticipo', 'No se permite'] },
  { key: 'pol_late', type: 'text', required: false,
    label: 'Tolerancia si el cliente llega tarde',
    options: ['5 minutos', '10 minutos', '15 minutos', 'No hay tolerancia'] },
  { key: 'pol_companions', type: 'text', required: false,
    label: 'Politica de acompañantes y menores',
    placeholder: 'Menores con padre/tutor. 1 acompañante en sala de espera' },
  { key: 'pol_complaints', type: 'text', required: false,
    label: 'Como reportar quejas o problemas',
    placeholder: 'WhatsApp, correo quejas@clinica.com, buzon en recepcion' },
  { key: 'pol_privacy', type: 'boolean', required: false,
    label: 'Tienen aviso de privacidad?' },
];

export const SHARED_SPECIAL_QUESTIONS: Question[] = [
  { key: 'spc_insurance', type: 'textarea', required: false,
    label: 'Aseguradoras que aceptan y como funciona',
    placeholder: 'AXA, GNP, Mapfre. Facturacion directa con AXA. Las demas: reembolso. Traer poliza vigente e ID' },
  { key: 'spc_emergency', type: 'text', required: false,
    label: 'Urgencias: horario y telefono de emergencias',
    placeholder: 'Urgencias L-V hasta 22:00. Tel: 999-123-4567' },
  { key: 'spc_conditions', type: 'multi_select', required: false,
    label: 'Atienden pacientes con condiciones especiales?',
    options: ['Embarazadas', 'Diabetes/hipertension', 'Alergias a medicamentos', 'Anticoagulados', 'Inmunosuprimidos', 'Oncologicos'] },
  { key: 'spc_ages', type: 'text', required: false,
    label: 'Rango de edades que atienden',
    placeholder: 'Desde 3 años. Odontopediatria para niños, geriatria para adultos mayores',
    options: ['Todas las edades', 'Solo adultos', 'Desde 3 años', 'Desde 12 años'] },
  { key: 'spc_virtual', type: 'boolean', required: false,
    label: 'Ofrecen teleconsulta o atencion virtual?' },
];

export const SHARED_EXPERIENCE_QUESTIONS: Question[] = [
  { key: 'exp_process', type: 'textarea', required: false,
    label: 'Como es la primera visita paso a paso',
    placeholder: '1. Llega y se registra 2. Llena historial 3. Pasa a valoracion 4. Diagnostico 5. Plan de tratamiento' },
  { key: 'exp_duration', type: 'text', required: false,
    label: 'Duracion de la primera consulta',
    options: ['15 min', '30 min', '45 min', '1 hora', '1.5 horas'] },
  { key: 'exp_bring', type: 'textarea', required: false,
    label: 'Que debe traer el paciente',
    placeholder: 'Identificacion, estudios previos, lista de medicamentos, datos del seguro' },
  { key: 'exp_preparation', type: 'text', required: false,
    label: 'Se necesita alguna preparacion previa?',
    options: ['No, ninguna', 'Ayuno 8 horas', 'Llegar 15 min antes', 'Llenar formulario previo'] },
  { key: 'exp_followup', type: 'text', required: false,
    label: 'Como se da seguimiento despues de la cita',
    placeholder: 'Plan de tratamiento por escrito. Resultados por WhatsApp en 24-48h. Segunda cita por bot',
    options: ['WhatsApp', 'Correo electronico', 'Llamada telefonica', 'En la siguiente cita'] },
];

export const SHARED_BRAND_QUESTIONS: Question[] = [
  { key: 'brand_name', type: 'text', required: true,
    label: 'Nombre del negocio',
    placeholder: 'Clinica Dental DentaCare' },
  { key: 'brand_description', type: 'textarea', required: false,
    label: 'Descripcion breve del negocio (historia, mision, valores)',
    placeholder: 'Fundada en 2010. Nuestra mision es brindar atencion dental de excelencia con calidez humana' },
  { key: 'brand_tone', type: 'multi_select', required: true,
    label: 'Tono que debe usar el bot',
    options: ['Formal', 'Cercano', 'Amigable', 'Profesional', 'Calido', 'Juvenil'] },
  { key: 'brand_greeting', type: 'text', required: false,
    label: 'Como debe saludar el bot',
    placeholder: 'Hola, soy Sofia, asistente virtual de DentaCare. En que puedo ayudarte?' },
  { key: 'brand_forbidden', type: 'textarea', required: false,
    label: 'Palabras o frases que el bot NUNCA debe usar',
    placeholder: 'No usar: wey, neta, chido. No usar anglicismos' },
  { key: 'brand_differentiator', type: 'textarea', required: false,
    label: 'Que te hace diferente (experiencia, premios, tecnologia)',
    placeholder: '15 años, +5000 pacientes, tomografo 3D, certificacion ISO 9001' },
  { key: 'brand_social', type: 'textarea', required: false,
    label: 'Redes sociales y sitio web',
    placeholder: 'Instagram: @dentacare, Facebook: /DentaCare, Web: www.dentacare.com.mx' },
  { key: 'brand_languages', type: 'multi_select', required: false,
    label: 'Idiomas que hablan',
    options: ['Espanol', 'Ingles', 'Frances', 'Portugues', 'Maya'] },
];

// ═══ ZONE → QUESTION KEY MAPPING ════════════════════════════════════════════

export const ZONE_QUESTION_KEYS: Record<ZoneId, string[]> = {
  schedule: ['hours_weekday', 'hours_weekend', 'schedule_booking', 'schedule_cancel', 'schedule_urgency', 'schedule_virtual',
    'schedule', 'scheduling', 'scheduling_preferences', 'checkin_out', 'same_day'],

  services: ['svc_list', 'svc_packages', 'svc_duration', 'svc_process', 'svc_requirements', 'svc_coverage',
    'services_prices', 'menu', 'services', 'services_offered', 'treatments', 'procedures', 'products', 'classes',
    'packages', 'exams', 'vaccines', 'lens_types', 'frame_brands', 'insurance_types', 'credit_types',
    'property_types', 'therapy_types', 'diagnostic_equipment', 'price_range', 'consultation', 'consultation_duration'],

  team: ['team_members', 'team_schedule', 'team_choose', 'team_languages', 'team_certified',
    'doctors', 'stylists', 'barbers', 'trainers'],

  location: ['loc_address', 'loc_maps', 'loc_parking', 'loc_transit', 'loc_accessibility',
    'parking', 'zones', 'airport_transfer', 'rooms', 'facilities', 'wifi'],

  payments: ['pay_methods', 'pay_financing', 'pay_deposit', 'pay_invoice', 'pay_cash_discount',
    'payment_methods', 'financing', 'tuition', 'cfdi_support', 'gift_cards', 'loyalty', 'memberships'],

  policies: ['pol_cancel', 'pol_late', 'pol_companions', 'pol_complaints', 'pol_privacy',
    'cancellation', 'confidentiality', 'warranty', 'turnaround', 'min_age', 'age_range'],

  special: ['spc_insurance', 'spc_emergency', 'spc_conditions', 'spc_ages', 'spc_virtual',
    'insurances', 'insurance', 'allergens', 'emergency', 'emergency_protocol', 'online',
    'online_sessions', 'telemedicine', 'hospitalization'],

  experience: ['exp_process', 'exp_duration', 'exp_bring', 'exp_preparation', 'exp_followup',
    'first_visit', 'first_session', 'visit_process', 'post_care', 'enrollment_process'],

  brand: ['brand_name', 'brand_description', 'brand_tone', 'brand_greeting', 'brand_forbidden',
    'brand_differentiator', 'brand_social', 'brand_languages',
    'approach', 'specialties', 'brands', 'food_menu', 'beverages', 'amenities', 'equipment',
    'tools', 'software', 'levels', 'species', 'carriers', 'extra_info'],

  logistics: ['delivery', 'delivery_platforms', 'reservations', 'pickup_delivery', 'catering', 'custom_orders'],

  'docs-menu': [],
  'docs-general': [],
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
  percent: number;
}

// All zones with shared questions use the same pattern now.
const SHARED_BY_ZONE: Partial<Record<ZoneId, Question[]>> = {
  schedule: SHARED_SCHEDULE_QUESTIONS,
  services: SHARED_SERVICES_QUESTIONS,
  team: SHARED_TEAM_QUESTIONS,
  location: SHARED_LOCATION_QUESTIONS,
  payments: SHARED_PAYMENTS_QUESTIONS,
  policies: SHARED_POLICIES_QUESTIONS,
  special: SHARED_SPECIAL_QUESTIONS,
  experience: SHARED_EXPERIENCE_QUESTIONS,
  brand: SHARED_BRAND_QUESTIONS,
};

function questionKeysForZone(zoneId: ZoneId, verticalQuestions: Question[]): string[] {
  const shared = SHARED_BY_ZONE[zoneId];
  if (shared) {
    const verticalKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS[zoneId].includes(k));
    return [...shared.map((q) => q.key), ...verticalKeys];
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
  const shared = SHARED_BY_ZONE[zoneId];
  if (shared) {
    const verticalQs = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS[zoneId].includes(q.key)
    );
    return [...shared, ...verticalQs];
  }
  const allowed = new Set(ZONE_QUESTION_KEYS[zoneId]);
  return verticalQuestions.filter((q) => allowed.has(q.key));
}
