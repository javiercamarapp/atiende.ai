// ═════════════════════════════════════════════════════════════════════════════
// FAQ AGENT — fast path sin LLM
//
// Si el mensaje del paciente matchea uno de los patterns de abajo, respondemos
// con la función directa contra Supabase. Cero LLM calls, latencia <50ms.
// Si no hay match, retornamos null y el processor delega al orquestador.
// ═════════════════════════════════════════════════════════════════════════════

import {
  getBusinessHours,
  getLocation,
  getServicesAndPrices,
  getInsuranceInfo,
} from './tools';

type FAQHandler = (tenantId: string) => Promise<string>;

interface FAQPattern {
  patterns: string[];
  handler: FAQHandler;
  intent: 'HOURS' | 'LOCATION' | 'PRICE' | 'INSURANCE';
}

export const FAQ_PATTERNS: readonly FAQPattern[] = [
  {
    patterns: ['horario', 'hora', 'atienden', 'abierto', 'cuando abren', 'que dias', 'que días', 'schedule'],
    handler: getBusinessHours,
    intent: 'HOURS',
  },
  {
    patterns: ['direccion', 'dirección', 'donde', 'dónde', 'ubicacion', 'ubicación', 'como llegar', 'cómo llegar', 'maps', 'estacionamiento', 'address'],
    handler: getLocation,
    intent: 'LOCATION',
  },
  {
    patterns: ['precio', 'precios', 'costo', 'cuanto cuesta', 'cuánto cuesta', 'cobran', 'cobra', 'tarifa', 'que servicios', 'qué servicios', 'lista de servicios', 'price'],
    handler: getServicesAndPrices,
    intent: 'PRICE',
  },
  {
    patterns: ['seguro', 'aseguradora', 'insurance', 'issste', 'imss', 'gastos medicos', 'gastos médicos', 'gnp', 'axxa', 'metlife'],
    handler: getInsuranceInfo,
    intent: 'INSURANCE',
  },
];

/** Normaliza acentos y mayúsculas para hacer matching tolerante. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strips diacritics
}

/**
 * Ejecuta el fast-path de FAQ. Retorna el texto formateado si hay match,
 * o `null` si ningún pattern matcheó (el processor delegará al LLM).
 */
export async function handleFAQ(
  message: string,
  tenantId: string,
): Promise<string | null> {
  const norm = normalize(message);
  for (const { patterns, handler } of FAQ_PATTERNS) {
    for (const p of patterns) {
      if (norm.includes(normalize(p))) {
        return await handler(tenantId);
      }
    }
  }
  return null;
}
