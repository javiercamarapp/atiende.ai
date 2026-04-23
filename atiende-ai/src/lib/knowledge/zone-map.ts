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
  { key: 'hours_urgency', type: 'boolean', required: false,
    label: '¿Tienen horario de urgencias o consultas de último momento?',
    placeholder: 'Sí, lunes a viernes hasta las 21:00' },
  { key: 'hours_holidays_open', type: 'boolean', required: false,
    label: '¿Atienden en días puente o períodos vacacionales?',
    placeholder: 'Solo días puente con cita previa' },
  { key: 'doctors_same_schedule', type: 'textarea', required: false,
    label: '¿Todos los doctores atienden los mismos días y horarios?',
    placeholder: 'No, Dr. López: L-M-V, Dra. García: M-J-S' },
  { key: 'consultation_duration', type: 'text', required: false,
    label: '¿Cuánto dura una consulta normalmente?',
    options: ['15 min', '30 min', '45 min', '1 hora', '1.5 horas', '2 horas'],
    placeholder: '30 a 45 minutos' },
  { key: 'booking_advance', type: 'text', required: false,
    label: '¿Con cuánto tiempo de anticipación se pueden agendar citas?',
    options: ['Mismo día', '1 día', '1 semana', '2 semanas', '1 mes'],
    placeholder: 'Hasta 30 días antes' },
  { key: 'same_day_cutoff', type: 'text', required: false,
    label: '¿Cuál es el último horario para agendar una cita el mismo día?',
    placeholder: 'Hasta las 16:00 del mismo día' },
  { key: 'reminder_advance', type: 'text', required: false,
    label: '¿Con cuánto tiempo de anticipación se recuerda la cita al paciente?',
    options: ['1 hora antes', '2 horas antes', '12 horas antes', '24 horas antes', '48 horas antes'],
    placeholder: '24 horas antes por WhatsApp' },
  { key: 'booking_after_hours', type: 'boolean', required: false,
    label: '¿Se puede agendar fuera de horario de atención?',
    placeholder: 'Sí, el bot agenda 24/7 para el siguiente día hábil' },
  { key: 'cancel_deadline', type: 'text', required: false,
    label: '¿Hasta qué hora puedo cancelar o reprogramar mi cita?',
    options: ['1 hora antes', '2 horas antes', '4 horas antes', '12 horas antes', '24 horas antes'],
    placeholder: '2 horas antes de la cita' },
  { key: 'arrival_time', type: 'text', required: false,
    label: '¿Cuánto tiempo antes debo llegar a mi cita?',
    options: ['5 minutos', '10 minutos', '15 minutos', '20 minutos', '30 minutos'],
    placeholder: '15 minutos antes' },
  { key: 'virtual_hours', type: 'boolean', required: false,
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
  { key: 'svc_payment_methods', type: 'multi_select', required: false,
    label: '¿Qué formas de pago aceptas?',
    options: ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Transferencia/SPEI', 'OXXO', 'PayPal', 'Mercado Pago'],
    placeholder: 'Efectivo, tarjeta, transferencia, OXXO' },
  { key: 'svc_discounts', type: 'boolean', required: false,
    label: '¿Ofreces descuentos?',
    placeholder: '10% a clientes frecuentes, 2x1 en limpieza los martes',
    help: 'Descuentos por volumen, clientes frecuentes, temporadas, códigos' },
  { key: 'svc_deposit', type: 'boolean', required: false,
    label: '¿Se requiere anticipo o depósito para reservar?',
    placeholder: '50% de anticipo para tratamientos mayores a $3,000' },
  { key: 'svc_currency', type: 'multi_select', required: false,
    label: '¿En qué moneda manejas tus precios?',
    options: ['Pesos mexicanos (MXN)', 'Dólares (USD)'],
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
  { key: 'team_choose_professional', type: 'boolean', required: false,
    label: '¿El cliente puede elegir con qué profesional ser atendido?',
    placeholder: 'Sí, al agendar puede seleccionar su doctor preferido' },
  { key: 'team_wait_time', type: 'text', required: false,
    label: '¿Cuánto es el tiempo de espera promedio para un profesional específico?',
    placeholder: '1 a 3 días para cita con especialista' },
  { key: 'team_same_professional', type: 'boolean', required: false,
    label: '¿Puede pedir que lo atienda siempre el mismo profesional?',
    placeholder: 'Sí, se puede fijar un doctor titular en el expediente' },
  { key: 'team_unavailable', type: 'text', required: false,
    label: '¿Qué pasa si su doctor/estilista no está disponible?',
    placeholder: 'Se ofrece cita con otro profesional o se reagenda' },
  { key: 'team_on_call', type: 'boolean', required: false,
    label: '¿Tienen médicos de guardia o atención de emergencia?',
    placeholder: 'Sí, emergencias dentales L-V hasta las 21:00' },
  { key: 'team_certified', type: 'boolean', required: false,
    label: '¿El personal está certificado o colegiado?',
    placeholder: 'Todos certificados por el Consejo Mexicano de su especialidad' },
  { key: 'team_patients_count', type: 'text', required: false,
    label: '¿Cuántos pacientes/clientes han atendido?',
    placeholder: 'Más de 5,000 pacientes en 10 años' },
  { key: 'team_awards', type: 'textarea', required: false,
    label: '¿Tiene el equipo logros o reconocimientos?',
    placeholder: 'Premio al mejor consultorio dental de Mérida 2024' },
  { key: 'team_continuing_education', type: 'boolean', required: false,
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
  { key: 'loc_valet', type: 'boolean', required: false,
    label: '¿Tienen valet parking?',
    placeholder: 'No / Sí, cortesía para pacientes' },
  { key: 'loc_bike_moto', type: 'boolean', required: false,
    label: '¿Hay estacionamiento para motos o bicicletas?',
    placeholder: 'Sí, bicicletero en la entrada' },
  { key: 'loc_public_transit', type: 'textarea', required: false,
    label: '¿Qué transporte público pasa cerca?',
    placeholder: 'Ruta 45 y 60, parada a 2 cuadras. Uber disponible en la zona' },
  { key: 'loc_accessibility', type: 'boolean', required: false,
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

export const SHARED_PAYMENTS_QUESTIONS: Question[] = [
  { key: 'pay_cards', type: 'multi_select', required: true,
    label: '¿Qué tarjetas aceptan?',
    options: ['Visa', 'Mastercard', 'American Express', 'Débito', 'No aceptamos tarjetas'],
    placeholder: 'Visa, Mastercard, Amex, débito' },
  { key: 'pay_digital', type: 'multi_select', required: false,
    label: '¿Aceptan pagos digitales? (transferencia, SPEI, CoDi, PayPal, etc.)',
    options: ['Transferencia/SPEI', 'CoDi', 'PayPal', 'Mercado Pago', 'Clip', 'Stripe', 'No aceptamos pagos digitales'],
    placeholder: 'Transferencia, SPEI, Mercado Pago' },
  { key: 'pay_checks', type: 'boolean', required: false,
    label: '¿Aceptan cheques?',
    placeholder: 'No / Sí, solo cheques certificados' },
  { key: 'pay_online', type: 'multi_select', required: false,
    label: '¿Se puede pagar en línea o solo en sucursal?',
    options: ['Solo en sucursal', 'Solo en línea', 'Ambos (en línea y en sucursal)'],
    placeholder: 'Ambos — link de pago por WhatsApp o en consultorio' },
  { key: 'pay_card_fee', type: 'boolean', required: false,
    label: '¿Hay comisión extra por pago con tarjeta?',
    placeholder: 'No, mismo precio en efectivo y tarjeta' },
  { key: 'pay_cfdi', type: 'boolean', required: false,
    label: '¿Emiten facturas (CFDI)?',
    placeholder: 'Sí, al momento o hasta 72 horas después' },
  { key: 'pay_cfdi_deadline', type: 'text', required: false,
    label: '¿Hasta cuándo pueden facturar después del pago?',
    placeholder: 'Dentro del mes en curso' },
  { key: 'pay_cfdi_data', type: 'text', required: false,
    label: '¿Qué datos necesitan para la factura?',
    placeholder: 'RFC, razón social, dirección fiscal, uso de CFDI, correo' },
  { key: 'pay_cfdi_type', type: 'multi_select', required: false,
    label: '¿Facturan a persona física y moral?',
    options: ['Persona física', 'Persona moral', 'Ambas'],
    placeholder: 'Sí, ambas' },
  { key: 'pay_deposit_required', type: 'boolean', required: false,
    label: '¿Se requiere anticipo para reservar cita?',
    placeholder: 'Sí, 50% para tratamientos mayores a $3,000' },
  { key: 'pay_deposit_percent', type: 'text', required: false,
    label: '¿Qué porcentaje se pide de anticipo?',
    options: ['20%', '30%', '50%', '100%'],
    placeholder: '30% del costo total' },
  { key: 'pay_deposit_cancel', type: 'text', required: false,
    label: '¿Qué pasa con el depósito si el cliente cancela?',
    placeholder: 'Se reembolsa si cancela con 24h de anticipación' },
  { key: 'pay_when', type: 'multi_select', required: false,
    label: '¿Cuándo se realiza el pago — antes, durante o después del servicio?',
    options: ['Antes del servicio', 'Durante el servicio', 'Al finalizar el servicio', 'Anticipo + resto al finalizar'],
    placeholder: 'Al finalizar la consulta' },
  { key: 'pay_partial', type: 'boolean', required: false,
    label: '¿Aceptan pagos parciales o meses sin intereses?',
    placeholder: 'Sí, 3, 6 y 12 MSI con tarjetas participantes' },
  { key: 'pay_cash_discount', type: 'boolean', required: false,
    label: '¿Tienen precio especial para pago en efectivo?',
    placeholder: '5% de descuento pagando en efectivo' },
];

export const SHARED_POLICIES_QUESTIONS: Question[] = [
  { key: 'pol_companions', type: 'boolean', required: false,
    label: '¿Pueden entrar acompañantes durante el servicio?',
    placeholder: 'Sí, 1 acompañante en sala de espera. En consulta solo el paciente' },
  { key: 'pol_minors', type: 'boolean', required: false,
    label: '¿Los menores necesitan ir con un adulto?',
    placeholder: 'Sí, menores de 18 años deben ir acompañados por padre o tutor' },
  { key: 'pol_pets', type: 'boolean', required: false,
    label: '¿Se permiten mascotas en el establecimiento?',
    placeholder: 'No, excepto perros guía' },
  { key: 'pol_late_arrival', type: 'text', required: false,
    label: '¿Qué pasa si el cliente llega tarde?',
    placeholder: 'Hasta 15 min de tolerancia. Después se reduce el tiempo o se reagenda' },
  { key: 'pol_photos', type: 'boolean', required: false,
    label: '¿Se pueden tomar fotos dentro del establecimiento?',
    placeholder: 'En áreas comunes sí, en consultorios no' },
  { key: 'pol_complaints', type: 'textarea', required: false,
    label: '¿Cómo puede el cliente reportar una queja o problema?',
    placeholder: 'Por WhatsApp, correo quejas@miclinica.com, o buzón en recepción. Respuesta en 24-48h',
    help: 'El bot puede orientar al paciente si tiene una queja' },
  { key: 'pol_cancellation', type: 'text', required: false,
    label: '¿Cuál es la política de cancelación?',
    placeholder: 'Cancelar con 24h de anticipación sin cargo. Menos de 24h se cobra 50%' },
  { key: 'pol_confidentiality', type: 'boolean', required: false,
    label: '¿Tienen política de confidencialidad o privacidad?',
    placeholder: 'Sí, apegados a la Ley Federal de Protección de Datos Personales' },
  { key: 'pol_warranty', type: 'boolean', required: false,
    label: '¿Ofrecen garantía en sus servicios?',
    placeholder: 'Sí, garantía de 6 meses en tratamientos restaurativos' },
];

export const SHARED_SPECIAL_QUESTIONS: Question[] = [
  { key: 'spc_insurers', type: 'textarea', required: false,
    label: '¿Qué aseguradoras aceptan?',
    placeholder: 'AXA, GNP, Mapfre, MetLife, Seguros Monterrey' },
  { key: 'spc_coverage', type: 'textarea', required: false,
    label: '¿Qué coberturas aplican y cuáles no?',
    placeholder: 'Consulta general y urgencias sí. Cirugía estética no cubierta' },
  { key: 'spc_insurance_docs', type: 'text', required: false,
    label: '¿Qué documentos debe traer el paciente con seguro?',
    placeholder: 'Póliza vigente, credencial, identificación oficial' },
  { key: 'spc_major_medical', type: 'boolean', required: false,
    label: '¿Trabajan con seguros de gastos médicos mayores?',
    placeholder: 'Sí, con carta de autorización previa de la aseguradora' },
  { key: 'spc_insurance_billing', type: 'multi_select', required: false,
    label: '¿Facturan directo a la aseguradora o el paciente paga y pide reembolso?',
    options: ['Facturación directa a la aseguradora', 'El paciente paga y pide reembolso', 'Ambos según la aseguradora'],
    placeholder: 'Facturación directa con AXA y GNP. Las demás: reembolso' },
  { key: 'spc_after_hours_emergency', type: 'boolean', required: false,
    label: '¿Atienden urgencias fuera del horario normal?',
    placeholder: 'Sí, emergencias dentales hasta las 22:00' },
  { key: 'spc_emergency_phone', type: 'boolean', required: false,
    label: '¿Tienen número de emergencias 24 hrs?',
    placeholder: 'Sí, 999-123-4567 para urgencias' },
  { key: 'spc_walk_in_emergency', type: 'boolean', required: false,
    label: '¿Atienden sin cita en casos urgentes?',
    placeholder: 'Sí, urgencias se atienden sin cita previa' },
  { key: 'spc_what_is_emergency', type: 'textarea', required: false,
    label: '¿Qué se considera una urgencia en su especialidad?',
    placeholder: 'Dolor intenso, fractura dental, sangrado, absceso, trauma' },
  { key: 'spc_pregnant', type: 'boolean', required: false,
    label: '¿Atienden mujeres embarazadas o en lactancia?',
    placeholder: 'Sí, con precauciones especiales. Evitamos radiografías en 1er trimestre' },
  { key: 'spc_chronic', type: 'boolean', required: false,
    label: '¿Atienden pacientes con diabetes, hipertensión u otras enfermedades crónicas?',
    placeholder: 'Sí, solicitamos estudios previos y coordinamos con su médico tratante' },
  { key: 'spc_allergies', type: 'text', required: false,
    label: '¿Atienden pacientes con alergias a medicamentos?',
    placeholder: 'Sí, siempre preguntamos alergias antes de cualquier procedimiento' },
  { key: 'spc_anticoagulants', type: 'text', required: false,
    label: '¿Atienden pacientes anticoagulados o con condiciones de riesgo?',
    placeholder: 'Sí, con protocolo especial y valoración previa' },
  { key: 'spc_immunosuppressed', type: 'text', required: false,
    label: '¿Tienen protocolos para pacientes inmunosuprimidos?',
    placeholder: 'Sí, medidas adicionales de bioseguridad y horarios preferenciales' },
  { key: 'spc_children_age', type: 'text', required: false,
    label: '¿Atienden niños? ¿Desde qué edad?',
    placeholder: 'Sí, desde los 3 años con odontopediatría' },
  { key: 'spc_elderly', type: 'text', required: false,
    label: '¿Atienden adultos mayores con necesidades geriátricas?',
    placeholder: 'Sí, con atención especializada y accesibilidad en planta baja' },
  { key: 'spc_oncology', type: 'text', required: false,
    label: '¿Atienden pacientes oncológicos o postoperatorios?',
    placeholder: 'Sí, coordinamos con su oncólogo para el plan de tratamiento' },
];

export const SHARED_EXPERIENCE_QUESTIONS: Question[] = [
  { key: 'exp_first_visit_process', type: 'textarea', required: true,
    label: '¿Cómo es el proceso paso a paso de la primera visita?',
    placeholder: '1. Llega y se registra en recepción 2. Llena historial clínico 3. Pasa a valoración 4. Se le explica el diagnóstico 5. Se agenda seguimiento',
    help: 'Desde que el paciente llega hasta que sale' },
  { key: 'exp_first_visit_duration', type: 'text', required: false,
    label: '¿Cuánto dura la primera consulta?',
    placeholder: '45 minutos a 1 hora' },
  { key: 'exp_diagnosis_first_visit', type: 'text', required: false,
    label: '¿Se hace diagnóstico en la primera visita o solo valoración?',
    placeholder: 'Diagnóstico completo con radiografías incluidas' },
  { key: 'exp_treatment_same_day', type: 'text', required: false,
    label: '¿Le dan tratamiento el mismo día o hay que agendar otra cita?',
    placeholder: 'Limpiezas sí, tratamientos complejos se agendan por separado' },
  { key: 'exp_fasting', type: 'text', required: false,
    label: '¿Debe llegar en ayunas o con preparación especial?',
    placeholder: 'No es necesario para consulta general. Para cirugía: 8h de ayuno' },
  { key: 'exp_medications_before', type: 'text', required: false,
    label: '¿Puede tomar sus medicamentos habituales antes de la cita?',
    placeholder: 'Sí, excepto anticoagulantes — consultar previamente' },
  { key: 'exp_arrive_early', type: 'text', required: false,
    label: '¿Cuánto tiempo antes debe llegar para el papeleo?',
    placeholder: '15 minutos antes para llenar historial clínico' },
  { key: 'exp_pre_forms', type: 'text', required: false,
    label: '¿Hay formularios para llenar por adelantado?',
    placeholder: 'Sí, enviamos el historial por WhatsApp para que lo llene antes' },
  { key: 'exp_documents', type: 'textarea', required: false,
    label: '¿Qué documentos debe traer a la primera cita?',
    placeholder: 'Identificación oficial, estudios previos, lista de medicamentos, datos del seguro si aplica' },
  { key: 'exp_referral_info', type: 'text', required: false,
    label: '¿Necesita traer datos de su médico de cabecera o quien lo refiere?',
    placeholder: 'Preferible si viene referido — nombre y teléfono del médico' },
  { key: 'exp_companion_needed', type: 'text', required: false,
    label: '¿Puede venir solo o necesita acompañante?',
    placeholder: 'Solo, excepto menores de edad o procedimientos con sedación' },
  { key: 'exp_minors_companion', type: 'text', required: false,
    label: '¿Quién debe acompañar a los menores?',
    placeholder: 'Padre, madre o tutor legal con identificación' },
  { key: 'exp_waiting_room', type: 'text', required: false,
    label: '¿Hay sala de espera? ¿Cuánto tiempo promedio de espera?',
    placeholder: 'Sí, con wifi y agua. Espera promedio: 10-15 minutos' },
  { key: 'exp_treatment_plan', type: 'text', required: false,
    label: '¿Le dan un plan de tratamiento por escrito?',
    placeholder: 'Sí, con diagnóstico, opciones de tratamiento y costos' },
  { key: 'exp_second_appointment', type: 'text', required: false,
    label: '¿Cómo se agenda la segunda cita?',
    placeholder: 'En recepción al salir, o por WhatsApp con el bot' },
  { key: 'exp_results_delivery', type: 'text', required: false,
    label: '¿Por qué medio dan los resultados o diagnóstico?',
    placeholder: 'En consulta presencial. Resultados de laboratorio por WhatsApp en 24-48h' },
];

export const SHARED_BRAND_QUESTIONS: Question[] = [
  { key: 'brand_history', type: 'textarea', required: false,
    label: '¿Cuál es la historia de tu negocio?',
    placeholder: 'Fundado en 2010 por el Dr. López, con la visión de...',
    help: 'Genera confianza y conexión emocional con el paciente' },
  { key: 'brand_mission', type: 'textarea', required: false,
    label: '¿Cuál es la misión y visión del negocio?',
    placeholder: 'Misión: brindar atención dental de excelencia. Visión: ser la clínica líder en el sureste' },
  { key: 'brand_values', type: 'textarea', required: false,
    label: '¿Cuáles son los valores de tu negocio?',
    placeholder: 'Calidez humana, honestidad, excelencia, innovación' },
  { key: 'brand_name_pronunciation', type: 'text', required: false,
    label: '¿Cómo se escribe y pronuncia el nombre de tu negocio?',
    placeholder: 'DentaCare (den-ta-ker), siempre con mayúscula en D y C' },
  { key: 'tone', type: 'text', required: true,
    label: '¿Qué tono debe usar tu bot?',
    placeholder: 'Formal, cercano, amigable',
    help: 'Cambia cómo le habla a tus clientes' },
  { key: 'brand_forbidden_words', type: 'textarea', required: false,
    label: '¿Qué palabras o frases NO debe usar el bot?',
    placeholder: 'No usar: "wey", "neta", "chido". No usar anglicismos innecesarios',
    help: 'Evita expresiones que no van con tu imagen' },
  { key: 'brand_preferred_words', type: 'textarea', required: false,
    label: '¿Qué palabras o frases SÍ debe usar frecuentemente?',
    placeholder: '"Con gusto", "Estamos para servirle", "Será un placer atenderle"' },
  { key: 'brand_complaint_handling', type: 'textarea', required: false,
    label: '¿Cómo debe manejar el bot las quejas o situaciones difíciles?',
    placeholder: 'Tono empático, disculparse, ofrecer solución y redirigir a un humano si no puede resolver' },
  { key: 'brand_bot_intro', type: 'textarea', required: false,
    label: '¿Cómo debe presentarse el bot al inicio de una conversación?',
    placeholder: 'Hola, soy Sofía, asistente virtual de DentaCare. ¿En qué puedo ayudarte?' },
  { key: 'tagline', type: 'text', required: false,
    label: 'Frase que te describe (tagline)',
    placeholder: 'Salud bucal con calidez yucateca' },
  { key: 'brand_years', type: 'text', required: false,
    label: '¿Cuántos años de experiencia o trayectoria tienen?',
    placeholder: '15 años atendiendo pacientes' },
  { key: 'brand_awards', type: 'textarea', required: false,
    label: '¿Tienen premios, reconocimientos o certificaciones de calidad?',
    placeholder: 'Certificación ISO 9001, Premio Estatal de Calidad 2023' },
  { key: 'brand_patients_count', type: 'text', required: false,
    label: '¿Cuántos pacientes/clientes han atendido?',
    placeholder: 'Más de 10,000 pacientes satisfechos' },
  { key: 'brand_technology', type: 'textarea', required: false,
    label: '¿Qué tecnología o equipamiento de vanguardia usan?',
    placeholder: 'Tomógrafo 3D, láser de diodos, escáner intraoral' },
  { key: 'brand_affiliations', type: 'text', required: false,
    label: '¿Están afiliados a asociaciones médicas o colegios?',
    placeholder: 'Asociación Dental Mexicana, Colegio de Cirujanos Dentistas de Yucatán' },
  { key: 'brand_social_media', type: 'textarea', required: false,
    label: '¿En qué redes sociales están? ¿Cuáles son sus usuarios?',
    placeholder: 'Instagram: @dentacare_merida, Facebook: /DentaCareMerida, TikTok: @dentacare' },
  { key: 'brand_website', type: 'text', required: false,
    label: '¿Tienen sitio web?',
    placeholder: 'www.dentacare.com.mx' },
  { key: 'brand_reviews', type: 'text', required: false,
    label: '¿Tienen reseñas en Google u otras plataformas?',
    placeholder: '4.9 estrellas en Google con 500+ reseñas' },
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

  payments: ['pay_cards', 'pay_digital', 'pay_checks', 'pay_online', 'pay_card_fee', 'pay_cfdi', 'pay_cfdi_deadline', 'pay_cfdi_data', 'pay_cfdi_type', 'pay_deposit_required', 'pay_deposit_percent', 'pay_deposit_cancel', 'pay_when', 'pay_partial', 'pay_cash_discount', 'payment_methods', 'financing', 'tuition', 'cfdi_support', 'gift_cards', 'loyalty', 'memberships', 'free_trial'],

  policies: ['pol_companions', 'pol_minors', 'pol_pets', 'pol_late_arrival', 'pol_photos', 'pol_complaints', 'pol_cancellation', 'pol_confidentiality', 'pol_warranty', 'cancellation', 'confidentiality', 'warranty', 'turnaround', 'min_age', 'age_range'],

  special: ['spc_insurers', 'spc_coverage', 'spc_insurance_docs', 'spc_major_medical', 'spc_insurance_billing', 'spc_after_hours_emergency', 'spc_emergency_phone', 'spc_walk_in_emergency', 'spc_what_is_emergency', 'spc_pregnant', 'spc_chronic', 'spc_allergies', 'spc_anticoagulants', 'spc_immunosuppressed', 'spc_children_age', 'spc_elderly', 'spc_oncology', 'insurances', 'insurance', 'allergens', 'vegetarian', 'kids_menu', 'pets', 'emergency', 'emergency_protocol', 'online', 'online_sessions', 'online_service', 'telemedicine', 'couples', 'happy_hour', 'events', 'hospitalization', 'ultrasound', 'prenatal_care', 'bridal', 'scholarships', 'extracurriculars'],

  experience: ['exp_first_visit_process', 'exp_first_visit_duration', 'exp_diagnosis_first_visit', 'exp_treatment_same_day', 'exp_fasting', 'exp_medications_before', 'exp_arrive_early', 'exp_pre_forms', 'exp_documents', 'exp_referral_info', 'exp_companion_needed', 'exp_minors_companion', 'exp_waiting_room', 'exp_treatment_plan', 'exp_second_appointment', 'exp_results_delivery', 'first_visit', 'first_session', 'visit_process', 'post_care', 'enrollment_process', 'arrangements', 'appointment_type', 'grooming', 'prescription_handling', 'otc_products', 'pharmacy', 'mortgage_help', 'claims_support', 'quote_process', 'parent_communication'],

  brand: ['brand_history', 'brand_mission', 'brand_values', 'brand_name_pronunciation', 'tone', 'brand_forbidden_words', 'brand_preferred_words', 'brand_complaint_handling', 'brand_bot_intro', 'tagline', 'brand_years', 'brand_awards', 'brand_patients_count', 'brand_technology', 'brand_affiliations', 'brand_social_media', 'brand_website', 'brand_reviews', 'languages', 'differentiator', 'approach', 'specialties', 'brands', 'food_menu', 'beverages', 'salsas', 'amenities', 'equipment', 'tools', 'software', 'breakfast', 'meal_plans', 'levels', 'species', 'carriers', 'extra_info'],

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
  if (zoneId === 'payments') {
    const verticalPayKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.payments.includes(k));
    return [...SHARED_PAYMENTS_QUESTIONS.map((q) => q.key), ...verticalPayKeys];
  }
  if (zoneId === 'policies') {
    const verticalPolKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.policies.includes(k));
    return [...SHARED_POLICIES_QUESTIONS.map((q) => q.key), ...verticalPolKeys];
  }
  if (zoneId === 'special') {
    const verticalSpcKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.special.includes(k));
    return [...SHARED_SPECIAL_QUESTIONS.map((q) => q.key), ...verticalSpcKeys];
  }
  if (zoneId === 'experience') {
    const verticalExpKeys = verticalQuestions
      .map((q) => q.key)
      .filter((k) => ZONE_QUESTION_KEYS.experience.includes(k));
    return [...SHARED_EXPERIENCE_QUESTIONS.map((q) => q.key), ...verticalExpKeys];
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
  if (zoneId === 'payments') {
    const verticalPay = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.payments.includes(q.key)
    );
    return [...SHARED_PAYMENTS_QUESTIONS, ...verticalPay];
  }
  if (zoneId === 'policies') {
    const verticalPol = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.policies.includes(q.key)
    );
    return [...SHARED_POLICIES_QUESTIONS, ...verticalPol];
  }
  if (zoneId === 'special') {
    const verticalSpc = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.special.includes(q.key)
    );
    return [...SHARED_SPECIAL_QUESTIONS, ...verticalSpc];
  }
  if (zoneId === 'experience') {
    const verticalExp = verticalQuestions.filter((q) =>
      ZONE_QUESTION_KEYS.experience.includes(q.key)
    );
    return [...SHARED_EXPERIENCE_QUESTIONS, ...verticalExp];
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
