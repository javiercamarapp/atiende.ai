import { openrouter, MODELS } from './openrouter';

// Clasifica el intent de cada mensaje entrante
// Usa GPT-5 Nano ($0.05/M tokens) — el mas barato del mercado
// Costo: ~$0.000005 por clasificacion = $4.50/mes a 100K msgs
export async function classifyIntent(message: string): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: MODELS.CLASSIFIER,
    messages: [{
      role: 'system',
      content: `Clasifica el mensaje del cliente en UNA sola categoria.
Categorias posibles:
  GREETING, FAREWELL, FAQ, PRICE, HOURS, LOCATION,
  APPOINTMENT_NEW, APPOINTMENT_MODIFY, APPOINTMENT_CANCEL,
  ORDER_NEW, ORDER_STATUS, RESERVATION,
  COMPLAINT, EMERGENCY, MEDICAL_QUESTION, LEGAL_QUESTION,
  HUMAN, CRISIS, REVIEW, THANKS, SPAM, OTHER.
Responde SOLO la categoria, nada mas.`
    }, {
      role: 'user', content: message
    }],
    max_tokens: 10,
    temperature: 0,
  });

  return response.choices[0].message.content?.trim() || 'OTHER';
}
