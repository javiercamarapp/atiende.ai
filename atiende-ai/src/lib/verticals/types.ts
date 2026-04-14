// Types for the 43-vertical onboarding system
// Source: atiende_guia_definitiva_40_verticales.pdf (132 pages, 743 questions)

export type VerticalCategory =
  | 'SALUD_Y_BIENESTAR'
  | 'GASTRONOMIA'
  | 'HOSPEDAJE_Y_TURISMO'
  | 'BELLEZA_Y_LIFESTYLE'
  | 'COMERCIOS_Y_RETAIL'
  | 'SERVICIOS_PROFESIONALES';

export type VerticalEnum =
  // Salud (10)
  | 'dental' | 'medico' | 'nutriologa' | 'psicologo' | 'dermatologo'
  | 'ginecologo' | 'pediatra' | 'oftalmologo' | 'farmacia' | 'veterinaria'
  // Gastronomia (6)
  | 'restaurante' | 'taqueria' | 'cafeteria' | 'panaderia' | 'bar_cantina' | 'food_truck'
  // Hospedaje (6)
  | 'hotel' | 'hotel_boutique' | 'motel' | 'glamping' | 'bb_hostal' | 'resort'
  // Belleza (6)
  | 'salon_belleza' | 'barberia' | 'spa' | 'gimnasio' | 'nail_salon' | 'estetica'
  // Retail (9)
  | 'floreria' | 'tienda_ropa' | 'papeleria' | 'ferreteria' | 'abarrotes'
  | 'libreria' | 'joyeria' | 'jugueteria' | 'zapateria'
  // Servicios (7)
  | 'contable_legal' | 'seguros' | 'taller_mecanico' | 'escuela' | 'agencia_digital' | 'fotografo'
  | 'condominio';

export type QuestionInputType = 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean' | 'number' | 'price_list';

export interface VerticalQuestion {
  number: number;
  text: string;
  why: string;
  inputType: QuestionInputType;
  required: boolean;
  followUpInsight?: string;
}

export interface SoftwareOption {
  name: string;
  price: string;
  description: string;
}

export interface VerticalMetadata {
  vertical: VerticalEnum;
  category: VerticalCategory;
  displayName: string;
  software: SoftwareOption[];
  apis: string[];
  topFaqs: string[];
  neverHallucinate: string[];
  crisisProtocols: string[];
  fallbackPhrase: string;
}

export interface VerticalDefinition {
  vertical: VerticalEnum;
  category: VerticalCategory;
  displayName: string;
  questions: VerticalQuestion[];
  metadata: VerticalMetadata;
}

export interface DetectionResult {
  vertical: VerticalEnum;
  displayName: string;
  category: VerticalCategory;
  insightMessage: string;
  totalQuestions: number;
}

export interface OnboardingSession {
  id: string;
  tenantId: string;
  businessType: VerticalEnum;
  currentQuestion: number;
  answers: Record<string, string>;
  channel: 'web' | 'whatsapp';
  status: 'in_progress' | 'completed' | 'abandoned';
  businessName?: string;
  createdAt: string;
  updatedAt: string;
}
