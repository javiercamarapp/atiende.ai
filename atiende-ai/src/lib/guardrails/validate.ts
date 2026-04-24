// Valida que la respuesta del LLM no invente informacion
// Se ejecuta DESPUES de cada generacion, ANTES de enviar al cliente

// Helpers de normalización para comparar precios del LLM contra el contexto
// RAG eliminando variaciones de formato ($800 vs $800.00 vs 800 vs $ 800
// vs 800.0).
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
    /\$?\s?(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g,
    (m, n: string) => canonicalizePrice(n) || m,
  );
}

/**
 * Refuerzo anti-alucinación de precios.
 *
 * Extrae TODOS los precios del RAG + calcula sumas válidas de hasta 3 ítems.
 * El LLM puede legítimamente sumar precios (ej. "Limpieza $500 + Extracción $300 = $800")
 * y antes el regex lo rechazaba como "inventado". Ahora aceptamos si el
 * número existe directo O es suma válida de 2-3 precios del catálogo.
 *
 * Trade-off: complejidad O(n³) para n=10 precios = 1,000 ops = <1ms. Seguro
 * dentro del hot path. Mejor que agregar un LLM judge (+500ms +$0.0005).
 */
function extractAllValidPrices(ctx: string): Set<string> {
  const valid = new Set<string>();
  const prices: number[] = [];
  const matches = ctx.matchAll(/\$?\s?(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g);
  for (const m of matches) {
    const can = canonicalizePrice(m[1]);
    if (!can) continue;
    const num = Number(can);
    if (num < 50 || num > 1_000_000) continue; // filtro: solo precios razonables
    prices.push(num);
    valid.add(can);
  }
  // Añadir sumas de 2 y 3 ítems (límite para no explotar combinatoria)
  const limit = Math.min(prices.length, 10);
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      valid.add(String(prices[i] + prices[j]));
      for (let k = j + 1; k < limit; k++) {
        valid.add(String(prices[i] + prices[j] + prices[k]));
      }
    }
  }
  return valid;
}

const CRISIS_MESSAGE =
  'Entiendo que estás pasando por un momento muy difícil. Tu vida importa. ' +
  'Por favor contacta la Línea de la Vida: 800 911 2000 (24/7) o SAPTEL: 55 5259 8121. ' +
  'Si es una emergencia, llama al 911. ' +
  '¿Quieres que te comunique con alguien de nuestro equipo?';

// Intents conversacionales que NUNCA deberían contener precios. Si aparece
// un número es ruido (ej. "somos 3 doctoras", "llame al 555-123") y no vale
// la pena pasarlo por el guardrail de precios.
const NON_PRICE_INTENTS = new Set([
  'GREETING',
  'FAREWELL',
  'THANKS',
  'SMALL_TALK',
  'COMPLAINT',
  'CRISIS',
]);

// Fallback por intent cuando una respuesta queda vacía (LLM devolvió null,
// guardrail borró todo, o timeout). Siempre algo útil al usuario en vez de
// silencio.
const INTENT_FALLBACKS: Record<string, string> = {
  GREETING: 'Hola, con gusto le atiendo. En qué le puedo ayudar?',
  FAREWELL: 'Gracias por escribirnos. Que tenga excelente día!',
  THANKS: 'Con gusto! Si necesita algo más, estamos para servirle.',
  APPOINTMENT_NEW: 'Con gusto le agendo su cita. Qué día le viene bien?',
  APPOINTMENT_MODIFY: 'Claro, le ayudo a modificar su cita. Cuál es su nombre o teléfono?',
  APPOINTMENT_CANCEL: 'Entendido, le ayudo a cancelar. Me confirma su nombre o teléfono?',
  PRICE: 'Para precios exactos, permítame verificar con el equipo y le confirmo.',
  HOURS: 'Permítame verificar nuestros horarios y le confirmo.',
  LOCATION: 'Con gusto le comparto nuestra ubicación.',
  FAQ: 'Permítame verificar con el equipo y le confirmo.',
};

const DEFAULT_FALLBACK = 'Permítame verificar con el equipo y le confirmo en breve.';

export function pickFallback(intent?: string): string {
  if (!intent) return DEFAULT_FALLBACK;
  return INTENT_FALLBACKS[intent] || DEFAULT_FALLBACK;
}

export function validateResponse(
  response: string,
  tenant: { business_type: string; name: string },
  ragContext: string,
  customerMessage?: string,
  intent?: string,
): { valid: boolean; text: string } {
  // Early guard: si el LLM devolvió vacío, usar fallback contextual por
  // intent antes de correr cualquier otra capa (ninguna tiene sentido
  // sobre string vacío y varias generan falsos positivos).
  if (!response || !response.trim()) {
    // Import dinámico: validate.ts es puro (sin side-effects en import) y
    // no queremos acoplar el guardrail al cliente Redis de monitoring.ts.
    void import('@/lib/monitoring').then((m) => m.trackFallback('guardrail_empty_input')).catch(() => {});
    return { valid: false, text: pickFallback(intent) };
  }

  let text = response;

  // ═══ CAPA 1: Verificar precios mencionados ═══
  // Saltear para intents conversacionales donde un número nunca es precio
  // (evita que "son 3 doctoras" o un telefono dispare el guardrail).
  const skipPriceValidation = intent ? NON_PRICE_INTENTS.has(intent) : false;

  // Normaliza AMBOS lados antes de comparar para evitar falsos positivos
  // por formato. "$800.00" debe match "$800"; "$1,200" debe match "1200";
  // símbolos de moneda, comas, ceros decimales innecesarios y espacios se
  // eliminan. Capa 1 sigue siendo conservadora: si el número entero no
  // existe en el RAG (ni en texto ni normalizado), la respuesta se
  // reemplaza.
  if (!skipPriceValidation) {
    const normalizedContext = normalizePrices(ragContext);
    // Además de lookup literal, calculamos sumas válidas (2-3 ítems) del
    // catálogo para que "Limpieza $500 + Extracción $300 = $800" no se marque
    // como alucinación si esos 2 precios están en el RAG.
    const validPriceSet = extractAllValidPrices(ragContext);
    const priceMatches = [...text.matchAll(/\$?\s?(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)];
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
        || ragContext.includes(num)
        || validPriceSet.has(canonical); // suma válida del catálogo

      if (!found) {
        return {
          valid: false,
          text: 'Para precios exactos y actualizados, le invito a ' +
                'consultarnos directamente. Le puedo ayudar con algo mas?'
        };
      }
    }
  }

  // ═══ CAPA 2: Guardrails medicos ═══
  // Forbidden list is stored WITHOUT accents; we normalize the LLM response
  // before matching so "diagnóstico" (the natural LLM output in Spanish) gets
  // caught the same as "diagnostico". Previously accents let the output slip
  // through entirely.
  const healthTypes = [
    'dental', 'medical', 'nutritionist', 'psychologist',
    'dermatologist', 'gynecologist', 'pediatrician',
    'ophthalmologist', 'veterinary', 'optics'
  ];
  if (healthTypes.includes(tenant.business_type)) {
    const forbidden = [
      'diagnostico', 'le recomiendo tomar', 'probablemente tiene',
      'mg de', 'es normal que', 'deberia usar', 'apliquese',
      'inyectese', 'no se preocupe', 'seguramente es',
      'parece ser', 'podria ser un caso de',
      // Extra coverage added after R21 audit. Keep lowercase + no accents;
      // normalizeForMedicalCheck() handles the match.
      'tomese', 'tome usted', 'aumente la dosis', 'reduzca la dosis',
      'suspenda el medicamento', 'cambie el tratamiento',
      'seguro es', 'seguramente tiene',
    ];
    const normalized = normalizeForMedicalCheck(text);
    for (const word of forbidden) {
      if (normalized.includes(word)) {
        return {
          valid: false,
          text: 'Esa consulta la resolvera mejor nuestro equipo ' +
                'en persona. Desea que le agende una cita?'
        };
      }
    }
  }

  // ═══ CAPA 3: Protocolo de crisis ═══
  // Extended from [psychologist, medical] to ALL health specialties.
  // A suicidal patient writing to a dentist/dermatologist/etc. still deserves
  // the crisis response — the line and the 911 referral don't depend on the
  // specialty, and failing to respond is an ethical/legal liability.
  if (healthTypes.includes(tenant.business_type)) {
    const crisisWords = [
      // All stored normalized (no accents). Input is normalized before match.
      'quiero morirme', 'no quiero vivir', 'suicidarme', 'suicidio',
      'me quiero matar', 'matarme', 'no le veo sentido',
      'me corto', 'me lastimo', 'hacerme dano', 'me hago dano',
      'quiero hacerme dano', 'estarian mejor sin mi',
      'ya no puedo mas', 'ya no aguanto', 'pensando en morir',
      'terminar con todo', 'acabar con mi vida',
    ];
    const normInput = normalizeForMedicalCheck(customerMessage || '');
    const hasCrisis = crisisWords.some((w) => normInput.includes(w));
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

// Normalizamos acentos y lowercase antes del match. La lista previa fallaba
// en "Creo Que Tengo" (capitalización) y en usuarios que omiten acentos
// ("sintomas", "sintomas de"). También ampliamos cobertura a expresiones
// comunes en México que la lista anterior no capturaba.
function normalizeForMedicalCheck(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // strip combining accents
}

const MEDICAL_QUERY_PATTERNS = [
  /creo que tengo/,
  /podria ser/,
  /sintomas? de/,
  /parece que (es|tengo|sea)/,
  /que (medicina|medicamento|pastilla|antibi[oó]tico|dosis|tratamiento)/,
  /me duele (el |la |los |las |un |una |mi |mucho|bastante)/,
  /me arde/,
  /me pica/,
  /siento (un|una|mucho|mucha|que)/,
  /tengo (fiebre|dolor|infeccion|inflamacion|mareo|nauseas|vomito|diarrea|tos|gripa|gripe)/,
  /es (grave|serio|peligroso|malo|normal)/,
  /se me (hincho|inflamo|durmio|entumio)/,
  /puedo tomar/,
  /deberia (tomar|usar|aplicar)/,
];

const MEDICAL_DISCLAIMER =
  '\n\nPara cualquier consulta médica, le recomendamos agendar una cita ' +
  'con el doctor para una evaluación profesional.';

// La idempotencia previa dependía de que el agente usara EXACTAMENTE la frase
// "evaluación profesional". Si la respuesta del LLM mencionaba "valoración
// profesional" o "cita con el médico", duplicábamos disclaimer. Ahora
// detectamos múltiples variantes normalizadas.
const EXISTING_DISCLAIMER_MARKERS = [
  'evaluacion profesional',
  'valoracion profesional',
  'consulta profesional',
  'evaluacion medica',
  'valoracion medica',
  'cita con el doctor',
  'cita con el medico',
  'agendar una cita',
];

/**
 * Si el mensaje del paciente contiene patrones de auto-diagnóstico o consulta
 * médica directa, agrega un disclaimer al final de la respuesta del agente.
 * Idempotente: detecta múltiples variantes del disclaimer en la respuesta.
 */
export function appendMedicalDisclaimer(
  userMessage: string,
  agentResponse: string,
): string {
  if (!userMessage || !agentResponse) return agentResponse;

  const normUser = normalizeForMedicalCheck(userMessage);
  const hasMedicalQuery = MEDICAL_QUERY_PATTERNS.some((p) => p.test(normUser));
  if (!hasMedicalQuery) return agentResponse;

  const normResp = normalizeForMedicalCheck(agentResponse);
  if (EXISTING_DISCLAIMER_MARKERS.some((m) => normResp.includes(m))) {
    return agentResponse;
  }

  return agentResponse + MEDICAL_DISCLAIMER;
}
