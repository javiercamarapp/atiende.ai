import type { VerticalEnum, VerticalMetadata } from '../types';

const fallbackPhrase = 'Permitame verificar esa informacion. Un momento por favor.';

export const hospedajeMetadata: Partial<Record<VerticalEnum, VerticalMetadata>> = {
  hotel: {
    vertical: 'hotel',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'Hotel',
    software: [
      { name: 'Oracle Opera Cloud', price: '$10-20 USD/room/mes', description: 'PMS lider 100+ rooms' },
      { name: 'Cloudbeds', price: '$108+ USD/mes', description: 'Cloud PMS + channel manager + AI' },
      { name: 'Hotelogix', price: '$7.99 USD/room/mes', description: 'Mid-size' },
      { name: 'SiteMinder', price: '56+ EUR/mes', description: 'Channel manager 450+ OTAs' },
    ],
    apis: [
      'Oracle Opera REST API',
      'Cloudbeds API + webhooks',
      'Hotelogix API',
      'SiteMinder API',
      'Booking.com Connectivity API',
      'Expedia Partner API',
    ],
    topFaqs: [
      'Horario de check-in y check-out?',
      'Tienen habitacion disponible para [fechas]?',
      'Desayuno/estacionamiento/WiFi esta incluido?',
      'Como llego desde el aeropuerto?',
      'Cual es la contrasena del WiFi?',
      'Horario de alberca/spa/gym?',
      'Puedo solicitar late check-out?',
      'Que restaurantes tienen?',
      'Estacionamiento disponible? Costo?',
      'Politica de cancelacion?',
    ],
    neverHallucinate: [
      'TARIFAS — cambian por temporada, demanda, canal. NUNCA inventar un precio',
      'DISPONIBILIDAD — debe consultar PMS en tiempo real',
      'AMENIDADES por tipo de habitacion — no todas las habitaciones tienen lo mismo',
      'PRECIOS de transfer — varian por vehiculo, distancia, horario',
      'SEGURIDAD de vecindario — nunca opinar',
      'PAQUETES all-inclusive — que incluye y que no es critico',
    ],
    crisisProtocols: [
      'HURACAN (costa mexicana): 72h previas: permitir cancelaciones sin penalizacion. 36h: ofrecer reubicacion. Durante: refugio en zonas interiores.',
      'SISMO: Evacuacion por rutas marcadas. Verificar danos estructurales antes de reocupar.',
      'OVERBOOKING: Asegurar hotel comparable cercano, pagar primera noche, transporte gratuito, compensacion.',
    ],
    fallbackPhrase,
  },

  hotel_boutique: {
    vertical: 'hotel_boutique',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'Hotel Boutique',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  motel: {
    vertical: 'motel',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'Motel',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  glamping: {
    vertical: 'glamping',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'Glamping',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  bb_hostal: {
    vertical: 'bb_hostal',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'B&B / Hostal',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },

  resort: {
    vertical: 'resort',
    category: 'HOSPEDAJE_Y_TURISMO',
    displayName: 'Resort',
    software: [],
    apis: [],
    topFaqs: [],
    neverHallucinate: [],
    crisisProtocols: [],
    fallbackPhrase,
  },
};
