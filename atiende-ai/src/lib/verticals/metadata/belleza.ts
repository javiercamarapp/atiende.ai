import type { VerticalEnum, VerticalMetadata } from '../types';

const fallbackPhrase = 'Permitame verificar esa informacion. Un momento por favor.';

export const bellezaMetadata: Partial<Record<VerticalEnum, VerticalMetadata>> = {
  salon_belleza: {
    vertical: 'salon_belleza',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Salon de Belleza',
    software: [
      { name: 'AgendaPro', price: '$299-4,500 MXN/mes+IVA', description: 'Lider LATAM booking' },
      { name: 'Fresha', price: 'Gratis base', description: '20% comision nuevos clientes marketplace' },
      { name: 'Booksy', price: '$520 MXN/mes', description: 'Single user + $350/staff extra' },
    ],
    apis: [
      'AgendaPro REST API (plan Pro)',
      'Fresha limited',
      'Booksy limited',
      'Google Calendar sync',
    ],
    topFaqs: [
      'Cuanto cuesta un corte/tinte/mechas?',
      'Tienen cita disponible hoy?',
      'Aceptan walk-ins?',
      'Cuanto tiempo tarda un servicio de color?',
      'Aceptan tarjeta/meses sin intereses?',
      'Tienen promociones?',
      'Puedo pedir un estilista especifico?',
      'Politica de cancelacion?',
      'Venden productos profesionales?',
      'Tienen paquete de novia?',
    ],
    neverHallucinate: [
      'PRECIOS — varian por estilista, largo de cabello, producto. ERROR = confrontacion',
      'DISPONIBILIDAD de estilista — agenda en tiempo real',
      'PROMOCIONES — solo las vigentes',
      'DURACION de servicio — color completo puede ser 3-4h, no inventar',
      'PRODUCTOS/MARCAS — si no esta en contexto, no inventar',
    ],
    crisisProtocols: [
      'REACCION ALERGICA a tinte: Enjuagar inmediatamente. Si hay dificultad respiratoria, 911. Documentar producto/lote.',
      'QUEMADURA quimica: Enjuagar, documentar, referir a medico si es severa.',
      'RESULTADO insatisfactorio: Escuchar, ofrecer correccion con estilista senior. No admitir culpa por escrito.',
    ],
    fallbackPhrase,
  },

  barberia: {
    vertical: 'barberia',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Barberia',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  spa: {
    vertical: 'spa',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Spa',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  gimnasio: {
    vertical: 'gimnasio',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Gimnasio',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  nail_salon: {
    vertical: 'nail_salon',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Nail Salon',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  estetica: {
    vertical: 'estetica',
    category: 'BELLEZA_Y_LIFESTYLE',
    displayName: 'Estetica',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },
};
