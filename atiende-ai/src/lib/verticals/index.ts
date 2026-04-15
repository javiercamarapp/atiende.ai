// Master registry of verticals for useatiende.ai.
//
// ⚠️  MVP SCOPE: useatiende.ai v1 se enfoca exclusivamente en agentes de reservas
// para los sectores de Salud y Estética — los verticales cuyo pilar operativo
// es el dashboard de Citas. El resto de verticales esta en `src/despues/`
// a la espera de ser reactivado en futuras iteraciones.
//
// Ver `src/despues/README.md` para detalles de la estrategia y el procedimiento
// para reactivar un vertical.

import type { VerticalEnum, VerticalCategory, VerticalDefinition } from './types';

// Question imports — solo verticales ACTIVOS
import { saludQuestions } from './questions/salud';
import { bellezaQuestions } from './questions/belleza';

// Metadata imports — solo verticales ACTIVOS
import { saludMetadata } from './metadata/salud';
import { bellezaMetadata } from './metadata/belleza';

import type { VerticalQuestion, VerticalMetadata } from './types';

// Category display names
export const CATEGORY_NAMES: Record<VerticalCategory, string> = {
  SALUD_Y_BIENESTAR: 'Salud y Bienestar',
  GASTRONOMIA: 'Gastronomia',
  HOSPEDAJE_Y_TURISMO: 'Hospedaje y Turismo',
  BELLEZA_Y_LIFESTYLE: 'Belleza y Lifestyle',
  COMERCIOS_Y_RETAIL: 'Comercios y Retail',
  SERVICIOS_PROFESIONALES: 'Servicios Profesionales',
};

// Vertical → category mapping (incluye ACTIVOS + FUTUROS — la lista de enums
// se mantiene completa para compatibilidad con DB, tipos y tests existentes).
export const VERTICAL_CATEGORY: Record<VerticalEnum, VerticalCategory> = {
  dental: 'SALUD_Y_BIENESTAR', medico: 'SALUD_Y_BIENESTAR', nutriologa: 'SALUD_Y_BIENESTAR',
  psicologo: 'SALUD_Y_BIENESTAR', dermatologo: 'SALUD_Y_BIENESTAR', ginecologo: 'SALUD_Y_BIENESTAR',
  pediatra: 'SALUD_Y_BIENESTAR', oftalmologo: 'SALUD_Y_BIENESTAR', farmacia: 'SALUD_Y_BIENESTAR',
  veterinaria: 'SALUD_Y_BIENESTAR',
  restaurante: 'GASTRONOMIA', taqueria: 'GASTRONOMIA', cafeteria: 'GASTRONOMIA',
  panaderia: 'GASTRONOMIA', bar_cantina: 'GASTRONOMIA', food_truck: 'GASTRONOMIA',
  hotel: 'HOSPEDAJE_Y_TURISMO', hotel_boutique: 'HOSPEDAJE_Y_TURISMO', motel: 'HOSPEDAJE_Y_TURISMO',
  glamping: 'HOSPEDAJE_Y_TURISMO', bb_hostal: 'HOSPEDAJE_Y_TURISMO', resort: 'HOSPEDAJE_Y_TURISMO',
  salon_belleza: 'BELLEZA_Y_LIFESTYLE', barberia: 'BELLEZA_Y_LIFESTYLE', spa: 'BELLEZA_Y_LIFESTYLE',
  gimnasio: 'BELLEZA_Y_LIFESTYLE', nail_salon: 'BELLEZA_Y_LIFESTYLE', estetica: 'BELLEZA_Y_LIFESTYLE',
  floreria: 'COMERCIOS_Y_RETAIL', tienda_ropa: 'COMERCIOS_Y_RETAIL', papeleria: 'COMERCIOS_Y_RETAIL',
  ferreteria: 'COMERCIOS_Y_RETAIL', abarrotes: 'COMERCIOS_Y_RETAIL', libreria: 'COMERCIOS_Y_RETAIL',
  joyeria: 'COMERCIOS_Y_RETAIL', jugueteria: 'COMERCIOS_Y_RETAIL', zapateria: 'COMERCIOS_Y_RETAIL',
  contable_legal: 'SERVICIOS_PROFESIONALES', seguros: 'SERVICIOS_PROFESIONALES',
  taller_mecanico: 'SERVICIOS_PROFESIONALES', escuela: 'SERVICIOS_PROFESIONALES',
  agencia_digital: 'SERVICIOS_PROFESIONALES', fotografo: 'SERVICIOS_PROFESIONALES',
  condominio: 'SERVICIOS_PROFESIONALES',
};

// Vertical display names (ACTIVOS + FUTUROS por compatibilidad)
export const VERTICAL_NAMES: Record<VerticalEnum, string> = {
  dental: 'Consultorio Dental', medico: 'Consultorio Medico', nutriologa: 'Nutriologa',
  psicologo: 'Psicologo', dermatologo: 'Dermatologo', ginecologo: 'Ginecologo',
  pediatra: 'Pediatra', oftalmologo: 'Oftalmologo', farmacia: 'Farmacia',
  veterinaria: 'Veterinaria',
  restaurante: 'Restaurante', taqueria: 'Taqueria', cafeteria: 'Cafeteria',
  panaderia: 'Panaderia', bar_cantina: 'Bar / Cantina', food_truck: 'Food Truck',
  hotel: 'Hotel', hotel_boutique: 'Hotel Boutique', motel: 'Motel',
  glamping: 'Glamping', bb_hostal: 'B&B / Hostal', resort: 'Resort All-Inclusive',
  salon_belleza: 'Salon de Belleza', barberia: 'Barberia', spa: 'Spa',
  gimnasio: 'Gimnasio', nail_salon: 'Salon de Unas', estetica: 'Clinica Estetica',
  floreria: 'Floreria', tienda_ropa: 'Tienda de Ropa', papeleria: 'Papeleria',
  ferreteria: 'Ferreteria', abarrotes: 'Tienda de Abarrotes', libreria: 'Libreria',
  joyeria: 'Joyeria', jugueteria: 'Jugueteria', zapateria: 'Zapateria',
  contable_legal: 'Contable / Legal', seguros: 'Agente de Seguros',
  taller_mecanico: 'Taller Mecanico', escuela: 'Escuela Privada',
  agencia_digital: 'Agencia Digital', fotografo: 'Fotografo',
  condominio: 'Administracion de Condominios',
};

// Verticales ACTIVAS — únicos que el onboarding ofrece en el MVP actual.
// Pilar: dashboard de Citas. Sectores: Salud y Estética.
export const ACTIVE_VERTICALS: VerticalEnum[] = [
  // Salud (9)
  'dental', 'medico', 'nutriologa', 'psicologo', 'dermatologo',
  'ginecologo', 'pediatra', 'oftalmologo', 'veterinaria',
  // Belleza / Estética (6)
  'salon_belleza', 'barberia', 'spa', 'gimnasio', 'nail_salon', 'estetica',
];

// Verticales FUTUROS — en standby en `src/despues/`. No se ofrecen en onboarding.
export const FUTURE_VERTICALS: VerticalEnum[] = [
  // Salud no-citas
  'farmacia',
  // Gastronomia
  'restaurante', 'taqueria', 'cafeteria', 'panaderia', 'bar_cantina', 'food_truck',
  // Hospedaje y Turismo
  'hotel', 'hotel_boutique', 'motel', 'glamping', 'bb_hostal', 'resort',
  // Comercios y Retail
  'floreria', 'tienda_ropa', 'papeleria', 'ferreteria', 'abarrotes',
  'libreria', 'joyeria', 'jugueteria', 'zapateria',
  // Servicios Profesionales
  'contable_legal', 'seguros', 'taller_mecanico', 'escuela', 'agencia_digital',
  'fotografo', 'condominio',
];

// Set para chequeos O(1) de si un vertical está activo.
const ACTIVE_SET = new Set<VerticalEnum>(ACTIVE_VERTICALS);

/** True si el vertical está activo en el MVP actual. */
export function isActiveVertical(vertical: VerticalEnum): boolean {
  return ACTIVE_SET.has(vertical);
}

// All question data combined — SOLO ACTIVOS. Se filtra farmacia que viene en salud.ts.
const ALL_QUESTIONS: Partial<Record<VerticalEnum, VerticalQuestion[]>> = {
  ...saludQuestions,
  ...bellezaQuestions,
};
delete ALL_QUESTIONS.farmacia;

// All metadata combined — SOLO ACTIVOS. Se filtra farmacia que viene en salud.ts.
const ALL_METADATA: Partial<Record<VerticalEnum, VerticalMetadata>> = {
  ...saludMetadata,
  ...bellezaMetadata,
};
delete ALL_METADATA.farmacia;

// Get questions for a vertical
export function getVerticalQuestions(vertical: VerticalEnum): VerticalQuestion[] {
  return ALL_QUESTIONS[vertical] || [];
}

// Get metadata for a vertical
export function getVerticalMetadata(vertical: VerticalEnum): VerticalMetadata | undefined {
  return ALL_METADATA[vertical];
}

// Get full definition for a vertical
export function getVerticalDefinition(vertical: VerticalEnum): VerticalDefinition | undefined {
  const questions = getVerticalQuestions(vertical);
  const metadata = getVerticalMetadata(vertical);
  if (!metadata || questions.length === 0) return undefined;
  return {
    vertical,
    category: VERTICAL_CATEGORY[vertical],
    displayName: VERTICAL_NAMES[vertical],
    questions,
    metadata,
  };
}

// List all available verticals (those with questions loaded — solo ACTIVOS).
export function getAvailableVerticals(): VerticalEnum[] {
  return Object.keys(ALL_QUESTIONS) as VerticalEnum[];
}

// ALL_VERTICALS incluye activos y futuros — se mantiene para compatibilidad con
// zod schemas, DB types, y validaciones defensivas. Para la lista que se ofrece
// al usuario en onboarding, usa `ACTIVE_VERTICALS`.
export const ALL_VERTICALS: VerticalEnum[] = Object.keys(VERTICAL_CATEGORY) as VerticalEnum[];
