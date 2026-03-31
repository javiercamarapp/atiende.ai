import axios from 'axios';

const WA_API = 'https://graph.facebook.com/v21.0';
const getHeaders = () => ({
  Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}`,
  'Content-Type': 'application/json',
});

// Enviar mensaje de texto simple
export async function sendTextMessage(
  phoneNumberId: string, to: string, text: string
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text',
      text: { body: text } },
    { headers: getHeaders() }
  );
}

// Enviar mensaje con botones (max 3 botones)
export async function sendButtonMessage(
  phoneNumberId: string, to: string,
  body: string, buttons: string[]
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((btn, i) => ({
            type: 'reply',
            reply: { id: `btn_${i}`, title: btn.substring(0, 20) }
          }))
        }
      }
    },
    { headers: getHeaders() }
  );
}

// Enviar lista de opciones (max 10 secciones x 10 items)
export async function sendListMessage(
  phoneNumberId: string, to: string,
  header: string, body: string,
  sections: { title: string; rows: { id: string; title: string;
    description?: string }[] }[]
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: header },
        body: { text: body },
        action: { button: 'Ver opciones', sections }
      }
    },
    { headers: getHeaders() }
  );
}

// Enviar template (recordatorios, promos — fuera de ventana 24h)
export async function sendTemplate(
  phoneNumberId: string, to: string,
  templateName: string, params: string[]
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es_MX' },
        components: [{
          type: 'body',
          parameters: params.map(p => ({ type: 'text', text: p }))
        }]
      }
    },
    { headers: getHeaders() }
  );
}

// Enviar ubicacion del negocio
export async function sendLocation(
  phoneNumberId: string, to: string,
  lat: number, lng: number, name: string, address: string
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'location',
      location: { latitude: lat, longitude: lng, name, address }
    },
    { headers: getHeaders() }
  );
}

// Marcar mensaje como leido
export async function markAsRead(
  phoneNumberId: string, messageId: string
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    },
    { headers: getHeaders() }
  );
}
