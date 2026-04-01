import { sendTextMessage, sendButtonMessage, sendListMessage, sendLocation } from '@/lib/whatsapp/send';

interface SmartResponseOpts {
  phoneNumberId: string;
  to: string;
  text: string;
  intent: string;
  tenant: {
    name: string;
    phone?: string;
    lat?: number;
    lng?: number;
    address?: string;
    business_type?: string;
  };
}

export async function sendSmartResponse(opts: SmartResponseOpts) {
  const { phoneNumberId, to, text, intent, tenant } = opts;

  // LOCATION → send map pin
  if (intent === 'LOCATION' && tenant.lat && tenant.lng) {
    await sendLocation(phoneNumberId, to, tenant.lat, tenant.lng, tenant.name, tenant.address || '');
    return;
  }

  // APPOINTMENT → interactive buttons
  if (['APPOINTMENT_NEW', 'APPOINTMENT_MODIFY', 'APPOINTMENT_CANCEL'].includes(intent)) {
    await sendButtonMessage(phoneNumberId, to, text, [
      'Agendar cita',
      'Ver horarios',
      'Hablar con alguien',
    ]);
    return;
  }

  // PRICE/SERVICES → buttons
  if (['PRICE', 'SERVICES_INFO'].includes(intent)) {
    await sendButtonMessage(phoneNumberId, to, text, [
      'Ver todos los servicios',
      'Agendar cita',
      'Más información',
    ]);
    return;
  }

  // ORDER (restaurants) → buttons
  if (['ORDER_NEW', 'ORDER_STATUS'].includes(intent)) {
    const isFood = ['restaurant', 'taqueria', 'cafe'].includes(tenant.business_type || '');
    if (isFood) {
      await sendButtonMessage(phoneNumberId, to, text, [
        'Ver menú',
        'Hacer pedido',
        'Estado de pedido',
      ]);
      return;
    }
  }

  // HOURS → with location button
  if (intent === 'HOURS') {
    await sendButtonMessage(phoneNumberId, to, text, [
      'Ver ubicación',
      'Agendar cita',
      'Llamar',
    ]);
    return;
  }

  // GREETING → welcome with quick options per industry
  if (intent === 'GREETING') {
    const options = getQuickOptions(tenant.business_type || 'other');
    await sendButtonMessage(phoneNumberId, to, text, options);
    return;
  }

  // HUMAN → transfer confirmation
  if (intent === 'HUMAN') {
    await sendButtonMessage(phoneNumberId, to, text, [
      'Sí, comuníqueme',
      'No, el bot me ayuda',
    ]);
    return;
  }

  // Default → plain text
  await sendTextMessage(phoneNumberId, to, text);
}

function getQuickOptions(businessType: string): string[] {
  const options: Record<string, string[]> = {
    dental: ['Agendar cita', 'Servicios y precios', 'Ubicación'],
    medical: ['Agendar consulta', 'Servicios', 'Ubicación'],
    restaurant: ['Ver menú', 'Hacer pedido', 'Reservar mesa'],
    taqueria: ['Ver menú', 'Hacer pedido', 'Ubicación'],
    cafe: ['Ver menú', 'Hacer pedido', 'Horarios'],
    hotel: ['Disponibilidad', 'Tarifas', 'Reservar'],
    real_estate: ['Ver propiedades', 'Agendar visita', 'Cotización'],
    salon: ['Agendar cita', 'Servicios', 'Ubicación'],
    barbershop: ['Agendar cita', 'Servicios', 'Ubicación'],
    spa: ['Tratamientos', 'Agendar cita', 'Paquetes'],
    gym: ['Membresías', 'Horarios', 'Clases'],
    veterinary: ['Agendar cita', 'Urgencias', 'Servicios'],
    pharmacy: ['Disponibilidad', 'Envío a domicilio', 'Horarios'],
    psychologist: ['Agendar sesión', 'Servicios', 'Primera vez'],
    school: ['Inscripciones', 'Información', 'Contacto'],
    insurance: ['Cotización', 'Pólizas', 'Siniestro'],
    mechanic: ['Agendar servicio', 'Cotización', 'Ubicación'],
    florist: ['Catálogo', 'Hacer pedido', 'Envío'],
    optics: ['Examen visual', 'Lentes', 'Ubicación'],
  };
  return options[businessType] || ['Servicios', 'Agendar', 'Ubicación'];
}
