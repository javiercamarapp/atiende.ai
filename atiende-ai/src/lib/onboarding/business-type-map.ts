// Mapping from the 43 VerticalEnum values used by the onboarding UI to the
// 26 values of the PostgreSQL `business_type` enum used by the tenants table.
//
// Several granular verticals collapse onto the same DB enum value:
//   - motel/glamping/resort/etc. → hotel
//   - tienda_ropa/papeleria/etc.  → other
// This is intentional: the DB enum drives dashboard module selection + LLM
// routing rules, which only need coarse-grained categories. The original
// fine-grained vertical is preserved inside `tenants.config.vertical` so
// the chat system prompt and agent metadata can still use it.

import type { VerticalEnum } from '@/lib/verticals/types';

// Mirrors `CREATE TYPE business_type AS ENUM (...)` in schema.sql
export type DbBusinessType =
  | 'dental'
  | 'medical'
  | 'nutritionist'
  | 'dermatologist'
  | 'psychologist'
  | 'gynecologist'
  | 'pediatrician'
  | 'ophthalmologist'
  | 'restaurant'
  | 'taqueria'
  | 'cafe'
  | 'hotel'
  | 'real_estate'
  | 'salon'
  | 'barbershop'
  | 'spa'
  | 'gym'
  | 'veterinary'
  | 'pharmacy'
  | 'school'
  | 'insurance'
  | 'mechanic'
  | 'accountant'
  | 'florist'
  | 'optics'
  | 'other';

const VERTICAL_TO_DB: Record<VerticalEnum, DbBusinessType> = {
  // Salud
  dental: 'dental',
  medico: 'medical',
  nutriologa: 'nutritionist',
  psicologo: 'psychologist',
  dermatologo: 'dermatologist',
  ginecologo: 'gynecologist',
  pediatra: 'pediatrician',
  oftalmologo: 'ophthalmologist',
  farmacia: 'pharmacy',
  veterinaria: 'veterinary',
  // Gastronomia
  restaurante: 'restaurant',
  taqueria: 'taqueria',
  cafeteria: 'cafe',
  panaderia: 'cafe',
  bar_cantina: 'restaurant',
  food_truck: 'restaurant',
  // Hospedaje — all collapse to 'hotel' in the DB enum
  hotel: 'hotel',
  hotel_boutique: 'hotel',
  motel: 'hotel',
  glamping: 'hotel',
  bb_hostal: 'hotel',
  resort: 'hotel',
  // Belleza
  salon_belleza: 'salon',
  barberia: 'barbershop',
  spa: 'spa',
  gimnasio: 'gym',
  nail_salon: 'salon',
  estetica: 'salon',
  // Retail
  floreria: 'florist',
  tienda_ropa: 'other',
  papeleria: 'other',
  ferreteria: 'other',
  abarrotes: 'other',
  libreria: 'other',
  joyeria: 'other',
  jugueteria: 'other',
  zapateria: 'other',
  // Servicios profesionales
  contable_legal: 'accountant',
  seguros: 'insurance',
  taller_mecanico: 'mechanic',
  escuela: 'school',
  agencia_digital: 'other',
  fotografo: 'other',
  condominio: 'other',
};

/**
 * Map a fine-grained VerticalEnum to the DB business_type enum value.
 * Falls back to `'other'` if the vertical is unknown (defensive).
 */
export function verticalToBusinessType(vertical: VerticalEnum): DbBusinessType {
  return VERTICAL_TO_DB[vertical] ?? 'other';
}
