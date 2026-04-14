// Industry insights shown when the conversational agent detects the vertical
// for the first time in a session. Each insight is a short, compelling stat
// or observation about the industry + a concrete value prop for atiende's
// WhatsApp agent — injected as the FIRST bubble in the agent's multi-message
// response right after vertical detection, before the LLM's own acknowledge
// and follow-up question.
//
// The content was originally authored for the rigid Q&A onboarding flow
// (src/lib/onboarding/detect-vertical.ts, now deprecated); we preserve it
// here as the source of truth so the conversational flow can reuse it.

import type { VerticalEnum } from '@/lib/verticals/types';
import { VERTICAL_NAMES } from '@/lib/verticals';

export const VERTICAL_INSIGHTS: Partial<Record<VerticalEnum, string>> = {
  // Salud
  dental: 'El 67% de las citas dentales se agendan fuera de horario laboral. Con tu agente AI vas a capturar todas esas consultas 24/7.',
  medico: 'Los pacientes mandan mensajes a las 10pm preguntando por citas. Tu agente nunca duerme y te va a ahorrar horas de admin.',
  nutriologa: 'El 80% de las consultas de nutrición empiezan con "¿cuánto cuesta?" por WhatsApp. Tu bot va a responder al instante y convertir más.',
  psicologo: 'La mayoría de las personas buscan psicólogo entre 11pm y 2am. Con tu agente vas a estar ahí cuando más te necesitan.',
  dermatologo: 'El 70% de las citas dermatológicas se agendan por WhatsApp. Automatizarlo se traduce directo en más ingresos.',
  ginecologo: 'Las pacientes prefieren WhatsApp para temas sensibles. Tu agente va a dar privacidad y rapidez sin saturar a tu recepción.',
  pediatra: 'Los papás preguntan a las 3am si llevar al bebé a urgencias. Tu bot va a orientar y escalar emergencias 24/7.',
  oftalmologo: 'El 40% de pacientes pregunta "¿cuánto cuesta LASIK?" antes de agendar. Tu bot va a cotizar al instante y capturar el lead.',
  farmacia: 'La pregunta #1 es "¿tienen este medicamento?". Tu bot va a responder disponibilidad en segundos y evitar llamadas perdidas.',
  veterinaria: 'Los dueños de mascotas mandan emergencias a cualquier hora. Tu bot va a dar orientación y el número de urgencias al instante.',

  // Gastronomía
  restaurante: 'El 45% de las reservaciones se hacen fuera de horario. Tu bot va a tomar reservas 24/7 sin que pierdas una mesa.',
  taqueria: '"¿Qué tacos tienen y a cómo?" es la pregunta #1. Tu bot va a responder menú completo y cerrar pedidos al instante.',
  cafeteria: 'La pregunta #1 de cafeterías es "¿cuál es la contraseña del WiFi?". Tu bot la va a dar en 2 segundos — y cerrar ventas de menú al mismo tiempo.',
  panaderia: '"¿A qué hora sale el pan caliente?" Tu bot va a dar horarios exactos por tipo de pan y evitar que el cliente llegue tarde.',
  bar_cantina: 'Los clientes preguntan "¿qué evento hay hoy?" y "¿cuánto es el cover?". Tu bot siempre va a saber y llenar más mesas.',
  food_truck: '"¿Dónde están hoy?" es la pregunta más crítica. Tu bot va a redirigir a tu ubicación actual automáticamente.',

  // Hospedaje
  hotel: 'El 60% de las reservaciones directas empiezan por WhatsApp. Tu bot va a subir tus reservas directas vs. OTAs y ahorrarte la comisión.',
  hotel_boutique: 'Los huéspedes boutique quieren atención personalizada. Tu bot va a ser un concierge privado sin pagar sueldo extra.',
  motel: '"¿Cuánto cuesta por hora?" es la #1. Tu bot va a responder tarifas exactas con discreción y cerrar más noches.',
  glamping: '"¿Cómo llego?" es la pregunta #1. Tu bot va a dar instrucciones detalladas con Google Maps.',
  bb_hostal: 'Los backpackers reservan a las 2am desde otro huso horario. Tu bot va a atender 24/7 en inglés y español.',
  resort: '"¿Qué incluye el all-inclusive?" es la pregunta más común. Tu bot va a detallar todo al instante y convertir más visitas en reservas.',

  // Belleza
  salon_belleza: 'El 70% de las citas de salón se agendan por WhatsApp después de las 8pm. Tu bot nunca va a cerrar.',
  barberia: '"¿Tienen espacio ahorita?" El 60% de tus clientes son walk-in. Tu bot va a indicar disponibilidad en tiempo real.',
  spa: 'Las reservaciones de spa se hacen 80% por mensaje. Tu bot va a mandar menú de tratamientos y cerrar reservas al instante.',
  gimnasio: '"¿Cuánto cuesta la membresía?" es la #1. Tu bot va a responder planes y precios al instante — más conversiones sin recepción saturada.',
  nail_salon: '"¿Cuánto cuesta gel/acrílico?" Tu bot va a responder precios por tamaño y tipo al instante.',
  estetica: 'Las consultas de estética son 60% fuera de horario. Tu bot va a responder precios y contraindicaciones sin esperar mañana.',

  // Retail
  floreria: 'En 14 de febrero y 10 de mayo, las florerías reciben 10x más mensajes. Tu bot va a atender todos y no perder ninguna venta de temporada.',
  tienda_ropa: '"¿Tienen esta prenda en talla X?" Tu bot va a responder stock y tallas al instante y reducir devoluciones.',
  papeleria: 'En back-to-school, las papelerías explotan de mensajes. Tu bot va a atender "¿tienen la lista de la escuela X?" sin romper la fila.',
  ferreteria: '"¿Qué me recomienda para [tarea]?" Tu bot va a dar asesoría técnica básica 24/7.',
  abarrotes: '"¿Tienen [producto]?" y "¿a cuánto?" — las 2 preguntas que tu bot va a responder al instante y cerrar pedidos.',
  libreria: '"¿Tienen el libro [título]?" Tu bot va a verificar disponibilidad al momento.',
  joyeria: 'El 70% de las compras de joyería empiezan con "¿cuánto cuesta [pieza]?" por WhatsApp. Tu bot va a responder y capturar al cliente de lujo.',
  jugueteria: 'En Navidad y Día del Niño, los mensajes se multiplican 5x. Tu bot va a atender todos sin saturar tu mostrador.',
  zapateria: '"¿Tienen este modelo en talla X?" Tu bot va a responder stock al instante y reducir viajes inútiles a la tienda.',

  // Servicios profesionales
  contable_legal: '"¿Cuándo debo presentar mi declaración?" Tu bot va a orientar a tus clientes sobre fechas límite sin saturarte a ti.',
  seguros: '"¿Cómo reporto un siniestro?" Tu bot va a dar números de emergencia al instante — servicio premium sin trabajo extra.',
  taller_mecanico: '"¿Cuánto cuesta la reparación de [X]?" Tu bot va a dar precios de servicios fijos al instante y capturar más citas.',
  escuela: 'Los padres preguntan requisitos de inscripción y colegiaturas a todas horas. Tu bot va a responder 24/7 y aumentar tu conversión de prospectos.',
  agencia_digital: '"¿Cuánto cuesta contratar una agencia?" Tu bot va a presentar paquetes y precios al instante — leads calificados antes de tu primera llamada.',
  fotografo: '"¿Tienes disponibilidad para [fecha]?" Tu bot va a verificar tu calendario y responder al momento, sin perder bookings.',
  condominio: 'El 78% de los residentes prefieren reportar fallas y pagar cuotas por WhatsApp. Tu agente va a gestionar solicitudes 24/7 sin saturar a tu equipo de administracion.',
};

/**
 * Return the insight string for a vertical, or a generic fallback if none
 * is registered. Guaranteed to return a non-empty string for any valid
 * VerticalEnum.
 */
export function getVerticalInsight(vertical: VerticalEnum): string {
  return (
    VERTICAL_INSIGHTS[vertical] ||
    `Configurar tu agente para tu ${VERTICAL_NAMES[vertical]} te va a ahorrar horas de atención y capturar clientes 24/7.`
  );
}
