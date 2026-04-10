// Master registry — PIVOTE: solo dental + restaurante activos.
// Los demás verticales están en /standby (no se importan).

import type { VerticalEnum, VerticalCategory, VerticalDefinition } from './types';

// Question imports — active categories (CITAS + PEDIDOS)
import { saludQuestions } from './questions/salud'; // 10 verticals → CITAS
import { bellezaQuestions } from './questions/belleza'; // 6 verticals → CITAS
import { gastronomiaQuestions } from './questions/gastronomia'; // 6 verticals → PEDIDOS

// Metadata imports — active categories
import { saludMetadata } from './metadata/salud';
import { bellezaMetadata } from './metadata/belleza';
import { gastronomiaMetadata } from './metadata/gastronomia';

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

// Vertical → category mapping
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
};

// Vertical display names
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
};

// All question data combined — CITAS (salud + belleza) + PEDIDOS (gastronomia)
const ALL_QUESTIONS: Partial<Record<VerticalEnum, VerticalQuestion[]>> = {
  ...saludQuestions,
  ...bellezaQuestions,
  ...gastronomiaQuestions,
};

// All metadata combined
const ALL_METADATA: Partial<Record<VerticalEnum, VerticalMetadata>> = {
  ...saludMetadata,
  ...bellezaMetadata,
  ...gastronomiaMetadata,
};

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

// List all available verticals (those with questions loaded)
export function getAvailableVerticals(): VerticalEnum[] {
  return Object.keys(ALL_QUESTIONS) as VerticalEnum[];
}

// All 43 vertical enums for detection
export const ALL_VERTICALS: VerticalEnum[] = Object.keys(VERTICAL_CATEGORY) as VerticalEnum[];
