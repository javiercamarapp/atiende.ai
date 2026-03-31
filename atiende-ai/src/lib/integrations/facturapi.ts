import axios from 'axios';

const FACTURAPI_URL = 'https://www.facturapi.io/v2';
const headers = () => ({
  Authorization: `Bearer ${process.env.FACTURAPI_KEY}`,
  'Content-Type': 'application/json',
});

// Crear factura CFDI para un servicio
export async function createInvoice(opts: {
  customerName: string;
  customerRFC: string;
  customerEmail: string;
  items: { description: string; quantity: number; price: number }[];
  paymentMethod: 'PUE' | 'PPD'; // Pago en Una Exhibición / Parcialidades
  usoCFDI?: string; // default: G03 (Gastos generales)
}) {
  if (!process.env.FACTURAPI_KEY) return null;
  try {
    const { data } = await axios.post(`${FACTURAPI_URL}/invoices`, {
      customer: {
        legal_name: opts.customerName,
        tax_id: opts.customerRFC,
        email: opts.customerEmail,
        tax_system: '601', // General de Ley
        address: { zip: '97000' }, // Mérida default
      },
      items: opts.items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        price: i.price,
        product_key: '86101700', // Servicios de salud default
      })),
      payment_form: '04', // Tarjeta de crédito
      payment_method: opts.paymentMethod,
      use: opts.usoCFDI || 'G03',
    }, { headers: headers() });
    return {
      invoiceId: data.id,
      uuid: data.uuid,
      pdfUrl: data.pdf_custom_section,
      xmlUrl: data.xml,
    };
  } catch (e) {
    console.error('Facturapi error:', e);
    return null;
  }
}
