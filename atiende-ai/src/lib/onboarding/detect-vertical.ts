// Vertical Detection Engine
// Classifies natural language business descriptions into one of 43 verticals
// Uses LLM (Gemini 2.5 Flash-Lite) via OpenRouter

import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { ALL_VERTICALS, VERTICAL_NAMES, VERTICAL_CATEGORY, getVerticalQuestions } from '@/lib/verticals';
import type { VerticalEnum, DetectionResult } from '@/lib/verticals/types';

const DETECTION_PROMPT = `Eres el sistema de clasificacion de atiende.ai.
El usuario describio su negocio. Clasificalo en UNA de estas 43 categorias:

SALUD: dental, medico, nutriologa, psicologo, dermatologo, ginecologo, pediatra, oftalmologo, farmacia, veterinaria
GASTRONOMIA: restaurante, taqueria, cafeteria, panaderia, bar_cantina, food_truck
HOSPEDAJE: hotel, hotel_boutique, motel, glamping, bb_hostal, resort
BELLEZA: salon_belleza, barberia, spa, gimnasio, nail_salon, estetica
RETAIL: floreria, tienda_ropa, papeleria, ferreteria, abarrotes, libreria, joyeria, jugueteria, zapateria
SERVICIOS: contable_legal, seguros, taller_mecanico, escuela, agencia_digital, fotografo

Responde SOLO con el enum exacto. Si no puedes clasificar, responde "unknown".

Negocio del usuario: "{input}"`;

// Warm, conversational greeting messages per vertical (shown after detection).
// Keep them short (1-2 lines), human, and value-focused — NO meta text like
// "la pregunta #1 es..." which leaks internal framing.
const VERTICAL_INSIGHTS: Partial<Record<VerticalEnum, string>> = {
  dental: 'Excelente, un consultorio dental. Mas del 60% de las citas llegan fuera de horario — tu agente va a atender cada una mientras tu descansas.',
  medico: 'Perfecto, un consultorio medico. Tu agente va a agendar citas 24/7 y nunca va a dejar a un paciente sin respuesta.',
  nutriologa: 'Genial, una consulta de nutricion. Vamos a hacer que tu agente responda precios, agende valoraciones y envie planes automatico.',
  psicologo: 'Perfecto. La mayoria de personas buscan apoyo a horas que tu no estas disponible — tu agente va a estar ahi con empatia y profesionalismo.',
  dermatologo: 'Excelente, dermatologia. Tu agente va a manejar consultas de precios, disponibilidad y tratamientos estéticos al instante.',
  ginecologo: 'Perfecto. Las pacientes valoran la privacidad y rapidez del WhatsApp — tu agente les dara ambas cosas.',
  pediatra: 'Genial, pediatria. Los papas mandan mensajes a cualquier hora — tu agente va a orientarlos y darles tranquilidad.',
  oftalmologo: 'Perfecto. Vamos a configurar tu agente para que responda todo sobre consultas, cirugias y precios al instante.',
  farmacia: 'Excelente, una farmacia. Tu agente va a responder disponibilidad de medicamentos, precios y horario al instante.',
  veterinaria: 'Genial, una veterinaria. Los duenos de mascotas mandan emergencias a cualquier hora — tu agente va a estar listo para orientarlos.',
  restaurante: 'Perfecto, un restaurante. Tu agente va a tomar reservaciones, responder el menu y precios 24/7 sin que tu muevas un dedo.',
  taqueria: 'Excelente, una taqueria. Tu agente va a responder tu menu completo, precios y ubicacion al instante — incluso a las 3am.',
  cafeteria: 'Genial, una cafeteria. Tu agente va a responder horarios, wifi, menu y todo lo que preguntan tus clientes habituales.',
  panaderia: 'Perfecto, una panaderia. Horarios de pan caliente, precios y pedidos especiales — tu agente va a manejarlo todo.',
  bar_cantina: 'Excelente. Tu agente va a responder eventos, cover, reservas y promociones sin que pierdas ni un mensaje.',
  food_truck: 'Genial, un food truck. Tu agente va a decirles donde estas hoy, el menu y precios — incluso cuando estas cocinando.',
  hotel: 'Perfecto, un hotel. Mas del 60% de las reservaciones directas empiezan por WhatsApp — tu agente va a capturarlas sin comision de OTA.',
  hotel_boutique: 'Excelente. Tu agente va a dar esa atencion personalizada de concierge que esperan tus huespedes.',
  motel: 'Perfecto. Tu agente va a manejar consultas de tarifas con discrecion y precision las 24 horas.',
  glamping: 'Genial, un glamping. Tu agente va a guiar con instrucciones de como llegar, disponibilidad y experiencias.',
  bb_hostal: 'Perfecto. Los backpackers reservan a cualquier hora desde otros husos horarios — tu agente va a atenderlos en espanol e ingles.',
  resort: 'Excelente, un resort. Tu agente va a explicar el todo incluido, responder precios y tomar reservas sin frenos.',
  salon_belleza: 'Perfecto, un salon de belleza. Mas del 70% de las citas llegan despues de las 8pm — tu agente nunca va a cerrar.',
  barberia: 'Genial, una barberia. La mitad de tus clientes van a llegar preguntando "hay espacio ahorita?" — tu agente va a saber al instante.',
  spa: 'Excelente, un spa. Tu agente va a enviar menu de tratamientos, precios y disponibilidad en segundos.',
  gimnasio: 'Perfecto, un gimnasio. Tu agente va a responder planes, precios, horarios y clases sin perder ni un lead.',
  nail_salon: 'Genial. Tu agente va a responder precios por tipo y tamano, disponibilidad y promociones al instante.',
  estetica: 'Perfecto. Tu agente va a responder tratamientos, precios y contraindicaciones con el cuidado que requieren.',
  floreria: 'Excelente, una floreria. Los 14 de febrero y 10 de mayo tu agente va a manejar 10x mas mensajes sin sudar.',
  tienda_ropa: 'Perfecto, una tienda de ropa. Tu agente va a responder disponibilidad, tallas, precios y envios en segundos.',
  papeleria: 'Genial. En back-to-school, tu agente va a atender cada "tienen la lista de [escuela]?" al instante.',
  ferreteria: 'Excelente. Tu agente va a dar asesoria tecnica basica y responder disponibilidad de productos 24/7.',
  abarrotes: 'Perfecto. Tu agente va a responder productos, precios y pedidos a domicilio sin que dejes de atender el mostrador.',
  libreria: 'Genial, una libreria. Tu agente va a verificar disponibilidad de titulos y responder recomendaciones al instante.',
  joyeria: 'Excelente, una joyeria. Mas del 70% de las ventas empiezan con "cuanto cuesta" por WhatsApp — tu agente va a responder con precio y fotos.',
  jugueteria: 'Perfecto. En Navidad y Dia del Nino, tu agente va a manejar 5x mas mensajes sin saturarse.',
  zapateria: 'Genial. Tu agente va a responder modelos, tallas y disponibilidad en el momento.',
  contable_legal: 'Perfecto, un despacho contable. Tu agente va a orientar clientes sobre fechas fiscales, servicios y precios — con la seriedad que requiere.',
  seguros: 'Excelente, seguros. Tu agente va a cotizar, explicar coberturas y dar numeros de emergencia de cada aseguradora al instante.',
  taller_mecanico: 'Perfecto, un taller mecanico. Tu agente va a dar precios de servicios fijos, garantias y agendar diagnosticos.',
  escuela: 'Genial, una escuela. Tu agente va a responder inscripciones, colegiaturas, uniformes y calendario 24/7 a los padres.',
  agencia_digital: 'Excelente, una agencia digital. Tu agente va a calificar leads, presentar paquetes y precios al instante.',
  fotografo: 'Perfecto. Tu agente va a verificar tu disponibilidad, enviar paquetes y cotizar bodas y sesiones sin que interrumpas tu trabajo.',
};

export async function detectVertical(userInput: string): Promise<DetectionResult | null> {
  const prompt = DETECTION_PROMPT.replace('{input}', userInput);

  const result = await generateResponse({
    model: MODELS.STANDARD,
    system: prompt,
    messages: [{ role: 'user', content: userInput }],
    maxTokens: 20,
    temperature: 0.1,
  });

  const detected = result.text.trim().toLowerCase().replace(/[^a-z_]/g, '') as VerticalEnum;

  if (!ALL_VERTICALS.includes(detected)) {
    return null;
  }

  const questions = getVerticalQuestions(detected);

  return {
    vertical: detected,
    displayName: VERTICAL_NAMES[detected],
    category: VERTICAL_CATEGORY[detected],
    insightMessage: VERTICAL_INSIGHTS[detected] || `Perfecto, un negocio de ${VERTICAL_NAMES[detected]}. Tu agente va a atender a tus clientes 24/7.`,
    totalQuestions: questions.length,
  };
}
