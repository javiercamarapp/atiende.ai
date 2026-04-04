import type { VerticalEnum, VerticalMetadata } from '../types';

const fallbackPhrase = 'Permitame verificar esa informacion. Un momento por favor.';

export const serviciosMetadata: Partial<Record<VerticalEnum, VerticalMetadata>> = {
  contable_legal: {
    vertical: 'contable_legal',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Despacho Contable / Legal',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  seguros: {
    vertical: 'seguros',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Agente de Seguros',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  taller_mecanico: {
    vertical: 'taller_mecanico',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Taller Mecanico',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  escuela: {
    vertical: 'escuela',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Escuela',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  agencia_digital: {
    vertical: 'agencia_digital',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Agencia Digital',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  fotografo: {
    vertical: 'fotografo',
    category: 'SERVICIOS_PROFESIONALES',
    displayName: 'Fotografo',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },
};
