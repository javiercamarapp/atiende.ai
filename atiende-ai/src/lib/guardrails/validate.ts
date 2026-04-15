// Valida que la respuesta del LLM no invente informacion
// Se ejecuta DESPUES de cada generacion, ANTES de enviar al cliente

// FIX 4 (audit R4): helpers de normalización para comparar precios del
// LLM contra el contexto RAG eliminando variaciones de formato
// ($800 vs $800.00 vs 800 vs $ 800 vs 800.0).
function canonicalizePrice(raw: string): string | null {
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return null;
  const num = Number(digits.replace(/(?<=\.\d*?)0+$/, ''));
  if (!isFinite(num) || num <= 0) return null;
  // Entero canonizado, sin ceros decimales innecesarios (800.00 → 800)
  if (Number.isInteger(num)) return String(num);
  return String(num);
}

function normalizePrices(ctx: string): string {
  // Reemplaza cualquier "$ 1,200.00" / "$1200" / "1,200 MXN" por su forma
  // canónica sin símbolos, para que includes() sobre el string normalizado
  // haga match del número solo.
  return ctx.replace(
    /\$?\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g,
    (m, n: string) => canonicalizePrice(n) || m,
  );
}

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
  // FIX 4 (audit R4): normaliza AMBOS lados antes de comparar para evitar
  // falsos positivos por formato. "$800.00" debe match "$800"; "$1,200"
  // debe match "1200"; símbolos de moneda, comas, ceros decimales
  // innecesarios y espacios se eliminan. Capa 1 sigue siendo conservadora:
  // si el número entero no existe en el RAG (ni en texto ni normalizado),
  // la respuesta se reemplaza.
  const normalizedContext = normalizePrices(ragContext);
  const priceMatches = [...text.matchAll(/\$?\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)];
  for (const match of priceMatches) {
    const raw = match[0];
    const num = match[1];
    // Solo consideramos "precio" si hay $ o si el número es de >=3 dígitos
    // (evita falsos positivos con "30 minutos", "5 días", etc.).
    const looksLikePrice = raw.includes('$') || Number(num.replace(/[,\s]/g, '')) >= 100;
    if (!looksLikePrice) continue;

    const canonical = canonicalizePrice(num);
    if (!canonical) continue;

    const found = normalizedContext.includes(canonical)
      || ragContext.includes(raw.trim())
      || ragContext.includes(num);

    if (!found) {
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
