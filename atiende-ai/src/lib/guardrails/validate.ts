// Valida que la respuesta del LLM no invente informacion
// Se ejecuta DESPUES de cada generacion, ANTES de enviar al cliente

const CRISIS_MESSAGE =
  'Entiendo que estás pasando por un momento muy difícil. Tu vida importa. ' +
  'Por favor contacta la Línea de la Vida: 800 911 2000 (24/7) o SAPTEL: 55 5259 8121. ' +
  'Si es una emergencia, llama al 911. ' +
  '¿Quieres que te comunique con alguien de nuestro equipo?';

export function validateResponse(
  response: string,
  tenant: { business_type: string; name: string },
  ragContext: string,
  customerMessage?: string
): { valid: boolean; text: string } {
  let text = response;

  // ═══ CAPA 1: Verificar precios mencionados ═══
  // Si el bot menciona un precio, DEBE existir en el contexto RAG
  const priceMatches = [...text.matchAll(/\$([\d,\.]+)/g)];
  for (const match of priceMatches) {
    const priceStr = match[0]; // ej: "$800"
    if (!ragContext.includes(priceStr) &&
        !ragContext.includes(match[1])) {
      // Precio inventado — reemplazar respuesta completa
      return {
        valid: false,
        text: 'Para precios exactos y actualizados, le invito a ' +
              'consultarnos directamente. Le puedo ayudar con algo mas?'
      };
    }
  }

  // ═══ CAPA 2: Guardrails medicos ═══
  const healthTypes = [
    'dental', 'medical', 'nutritionist', 'psychologist',
    'dermatologist', 'gynecologist', 'pediatrician',
    'ophthalmologist'
  ];
  if (healthTypes.includes(tenant.business_type)) {
    const forbidden = [
      'diagnostico', 'le recomiendo tomar', 'probablemente tiene',
      'mg de', 'es normal que', 'deberia usar', 'apliquese',
      'inyectese', 'no se preocupe', 'seguramente es',
      'parece ser', 'podria ser un caso de'
    ];
    const lower = text.toLowerCase();
    for (const word of forbidden) {
      if (lower.includes(word)) {
        return {
          valid: false,
          text: 'Esa consulta la resolvera mejor nuestro equipo ' +
                'en persona. Desea que le agende una cita?'
        };
      }
    }
  }

  // ═══ CAPA 3: Protocolo de crisis (psicologia/medico) ═══
  const crisisTypes = ['psychologist', 'medical'];
  if (crisisTypes.includes(tenant.business_type)) {
    const crisisWords = [
      'quiero morirme', 'no quiero vivir', 'suicidarme',
      'me quiero matar', 'no le veo sentido', 'me corto',
      'me lastimo', 'hacerme dano', 'estarian mejor sin mi'
    ];
    const inputLower = (customerMessage || '').toLowerCase();
    const hasCrisis = crisisWords.some(w => inputLower.includes(w));
    if (hasCrisis) {
      return { valid: true, text: CRISIS_MESSAGE };
    }
  }

  // ═══ CAPA 4: Longitud maxima WhatsApp ═══
  if (text.length > 600) {
    text = text.substring(0, 597) + '...';
  }

  return { valid: true, text };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEGUNDA CAPA ANTI-DIAGNÓSTICO — disclaimer pasivo cuando el paciente
// pregunta algo médico. NO bloquea la respuesta del agente; solo agrega un
// recordatorio amigable de agendar consulta. Cubre patrones que la lista
// léxica de validateResponse() no captura porque están en el INPUT del
// paciente (no en el output del LLM).
// ═══════════════════════════════════════════════════════════════════════════

const MEDICAL_QUERY_PATTERNS = [
  /creo que tengo/i,
  /podr[íi]a ser/i,
  /s[íi]ntomas? de/i,
  /parece que es/i,
  /qu[ée] medicina/i,
  /qu[ée] pastilla/i,
  /qu[ée] dosis/i,
  /me duele (el|la|los|las|un|una)/i,
  /tengo (fiebre|dolor|infecci[óo]n|inflamaci[óo]n)/i,
  /es (grave|serio|peligroso)/i,
];

const MEDICAL_DISCLAIMER =
  '\n\nPara cualquier consulta médica, le recomendamos agendar una cita ' +
  'con el doctor para una evaluación profesional.';

/**
 * Si el mensaje del paciente contiene patrones de auto-diagnóstico o consulta
 * médica directa, agrega un disclaimer al final de la respuesta del agente.
 * Idempotente: si el agente ya incluyó "evaluación profesional", no duplica.
 */
export function appendMedicalDisclaimer(
  userMessage: string,
  agentResponse: string,
): string {
  if (!userMessage || !agentResponse) return agentResponse;

  const hasMedicalQuery = MEDICAL_QUERY_PATTERNS.some((p) => p.test(userMessage));
  if (!hasMedicalQuery) return agentResponse;

  if (agentResponse.includes('evaluación profesional')) {
    return agentResponse; // ya tiene el disclaimer
  }

  return agentResponse + MEDICAL_DISCLAIMER;
}
