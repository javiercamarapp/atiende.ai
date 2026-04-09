// TODO(onboarding-v2): deprecated — vertical detection now happens inline
// inside runChatAgent (or via detectVerticalFromContext in chat-agent.ts).
// Delete in a follow-up PR once the conversational flow is validated in prod.
//
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

// Insight messages per vertical (shown after detection)
const VERTICAL_INSIGHTS: Partial<Record<VerticalEnum, string>> = {
  dental: 'El 67% de las citas dentales se agendan fuera de horario laboral. Con tu agente AI, vas a capturar esas citas 24/7.',
  medico: 'Los pacientes envian mensajes a las 10pm preguntando por citas. Tu agente AI nunca duerme.',
  nutriologa: 'El 80% de las consultas de nutricion empiezan con "cuanto cuesta" por WhatsApp. Tu bot respondera al instante.',
  psicologo: 'La mayoria de personas buscan psicologo a las 11pm-2am. Tu agente estara ahi cuando mas lo necesitan.',
  dermatologo: 'Las consultas dermatologicas se agendan 70% por WhatsApp. Automatizar = mas citas.',
  ginecologo: 'Las pacientes prefieren WhatsApp para temas sensibles. Tu agente dara privacidad y rapidez.',
  pediatra: 'Los papas preguntan a las 3am si llevar al bebe a urgencias. Tu bot orientara y dara el numero de urgencias.',
  oftalmologo: 'El 40% de pacientes pregunta "cuanto cuesta la cirugia LASIK" antes de agendar. Tu bot respondera al instante.',
  farmacia: 'La pregunta #1 es "tienen [medicamento]?" — tu bot respondera disponibilidad en segundos.',
  veterinaria: 'Los duenos de mascotas envian emergencias a cualquier hora. Tu bot dara el numero de urgencias al instante.',
  restaurante: 'El 45% de las reservaciones se hacen fuera de horario. Tu bot tomara reservaciones 24/7.',
  taqueria: 'La pregunta #1 es "que tacos tienen y a como?" — tu bot respondera tu menu completo al instante.',
  cafeteria: 'La pregunta #1 de cafeterias es "cual es la contrasena del WiFi?" — tu bot la dara en 2 segundos.',
  panaderia: '"A que hora sale el pan caliente?" — tu bot respondera horarios exactos por tipo de pan.',
  bar_cantina: 'Los clientes preguntan "que evento hay hoy?" y "cuanto es el cover?" — tu bot siempre sabra.',
  food_truck: '"Donde estan hoy?" — la pregunta mas critica. Tu bot redirigira a tus stories de Instagram.',
  hotel: 'El 60% de las reservaciones directas empiezan por WhatsApp. Tu bot aumentara reservaciones directas vs. OTAs.',
  hotel_boutique: 'Los huespedes de boutique quieren atencion personalizada. Tu bot sera como un concierge privado.',
  motel: 'La pregunta #1 es "cuanto cuesta por hora?" — tu bot respondera tarifas exactas discretamente.',
  glamping: '"Como llego?" es la pregunta #1. Tu bot dara instrucciones detalladas con Google Maps.',
  bb_hostal: 'Los backpackers reservan a las 2am desde otro huso horario. Tu bot atendera 24/7 en ingles y espanol.',
  resort: '"Que incluye el all-inclusive?" — la pregunta mas comun. Tu bot detallara todo al instante.',
  salon_belleza: 'El 70% de las citas de salon se agendan por WhatsApp despues de las 8pm. Tu bot nunca cierra.',
  barberia: '"Tienen espacio ahorita?" — el 60% de clientes de barberia son walk-in. Tu bot indicara disponibilidad.',
  spa: 'Las reservaciones de spa se hacen 80% por mensaje. Tu bot enviara menu de tratamientos y disponibilidad.',
  gimnasio: '"Cuanto cuesta la membresia?" es pregunta #1. Tu bot respondera planes y precios al instante.',
  nail_salon: '"Cuanto cuesta gel/acrilico?" — tu bot respondera precios por tamano y tipo al instante.',
  estetica: 'Las consultas de estetica son 60% fuera de horario. Tu bot respondera precios y contraindicaciones.',
  floreria: 'En 14 de febrero y 10 de mayo, las florerias reciben 10x mas mensajes. Tu bot atendera todos.',
  tienda_ropa: '"Tienen esta prenda en talla X?" — tu bot respondera stock y tallas al instante.',
  papeleria: 'En back-to-school, las papelerias explotan de mensajes. Tu bot atendera "tienen la lista de [escuela]?".',
  ferreteria: '"Que me recomienda para [tarea]?" — tu bot dara asesoria tecnica basica 24/7.',
  abarrotes: '"Tienen [producto]?" y "a cuanto?" — las 2 preguntas que tu bot respondera al instante.',
  libreria: '"Tienen el libro [titulo]?" — tu bot verificara disponibilidad al momento.',
  joyeria: 'El 70% de compras de joyeria empiezan con "cuanto cuesta [pieza]?" por WhatsApp.',
  jugueteria: 'En Navidad y Dia del Nino, los mensajes se multiplican 5x. Tu bot atendera todos.',
  zapateria: '"Tienen este modelo en talla X?" — la pregunta que tu bot respondera al instante.',
  contable_legal: '"Cuando debo presentar mi declaracion?" — tu bot orientara a tus clientes sobre fechas limite.',
  seguros: '"Como reporto un siniestro?" — tu bot dara numeros de emergencia de aseguradoras al instante.',
  taller_mecanico: '"Cuanto cuesta la reparacion de [X]?" — tu bot dara precios de servicios fijos al instante.',
  escuela: 'Los padres preguntan requisitos de inscripcion y colegiaturas a todas horas. Tu bot respondera 24/7.',
  agencia_digital: '"Cuanto cuesta contratar una agencia?" — tu bot presentara paquetes y precios al instante.',
  fotografo: '"Tienes disponibilidad para [fecha]?" — tu bot verificara tu calendario y respondera al momento.',
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
    insightMessage: VERTICAL_INSIGHTS[detected] || `Vamos a configurar tu agente AI para tu ${VERTICAL_NAMES[detected]}.`,
    totalQuestions: questions.length,
  };
}
